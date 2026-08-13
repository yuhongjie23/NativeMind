//! 电子书解析（EPUB / MOBI / AZW3）
//!
//! 分工：Rust 负责 IO 与二进制解码（EPUB 容器解包、MOBI 解压、HTML→文本），
//! 前端 `EbookParser` 只做清洗、标题推断和 markdown 组装（与 PDF 的分工一致）。
//!
//! 引擎：lib-epub（EPUB 2/3）、mobi（MOBI/AZW3）、html2text（HTML→纯文本）。
//! html2text 会把 `<h1>`/`<h2>` 渲染成 `#`/`##` 的 ATX 标题、段落用空行分隔，
//! 所以这里产出的章节文本天然就是 markdown，切分器能直接拿到 heading path。
//!
//! AZW3（KF8）说明：mobi crate 对 KF8 容器的支持是尽力而为，遇到解不出正文
//! 会给明确错误而不是静默返回空内容。

use std::io::Cursor;
use std::path::Path;

use serde::Serialize;

use crate::utils::{CommandError, CommandResult};

/// 单个电子书大小上限（与 PDF 一致）
const MAX_EBOOK_BYTES: u64 = 256 * 1024 * 1024;

/// html2text 的渲染宽度。0 会返回空文本，这里用一个大宽度近似「不折行」，
/// 段落保持一行一块，切分器按 `\n{2,}` 划段更干净。
const HTML2TEXT_WIDTH: usize = 10_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EbookChapter {
    /// 已含 markdown 标题（如 `# 第一章`）的正文
    pub text: String,
}

/// 与前端 `EbookDocument` 结构对应
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EbookDocument {
    pub title: Option<String>,
    pub author: Option<String>,
    pub chapters: Vec<EbookChapter>,
}

fn extension_of(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase())
}

/// 抽取电子书正文。解析是 CPU 密集操作，放进 blocking 线程池——
/// 与 PDF 抽取同样的理由：不卡 async 主循环，panic 只让这条命令失败。
pub async fn extract(path: &Path) -> CommandResult<EbookDocument> {
    if !tokio::fs::try_exists(path).await.unwrap_or(false) {
        return Err(CommandError::new("电子书文件不存在"));
    }

    let metadata = tokio::fs::metadata(path).await?;
    if metadata.len() > MAX_EBOOK_BYTES {
        return Err(CommandError::new(format!(
            "电子书过大（{:.1} MB），上限 {} MB",
            metadata.len() as f64 / 1_048_576.0,
            MAX_EBOOK_BYTES / 1_048_576
        )));
    }

    let owned = path.to_path_buf();
    let extension = extension_of(path);
    tokio::task::spawn_blocking(move || match extension.as_deref() {
        Some("epub") => parse_epub(&owned),
        Some("mobi") | Some("azw3") | Some("azw") | Some("prc") => parse_mobi(&owned),
        Some(other) => Err(CommandError::new(format!("不支持的电子书格式：{other}"))),
        None => Err(CommandError::new("无法识别电子书格式（缺少扩展名）")),
    })
    .await
    .map_err(|_| CommandError::new("电子书解析线程异常退出"))?
}

/// EPUB：按 spine 逐章解包，每章 XHTML 转 markdown 文本
fn parse_epub(path: &Path) -> CommandResult<EbookDocument> {
    // lib-epub 0.3.1 对「EPUB 2.0 中缺 id 属性的 <meta> 标签」会在内部 unwrap panic
    // （epub.rs:1154 `id.clone().unwrap()`）。这是库 bug，无升级版可修。
    //
    // catch_unwind 把 panic 转成明确错误；但默认 panic hook 仍会把 trace 打到 stderr
    // （一屏幕吓人的 Rust 回溯），所以捕获期间临时静音 hook，捕获后恢复并打一条
    // 简洁的日志。静音窗口只覆盖这一次解析，其它线程的 panic 不受影响。
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));

    let result = std::panic::catch_unwind(|| {
        let doc = lib_epub::epub::EpubDoc::new(path)
            .map_err(|error| CommandError::new(format!("EPUB 解析失败：{error}")))?;

        let title = doc
            .get_title()
            .into_iter()
            .find(|value| !value.trim().is_empty());
        let author = doc
            .get_metadata_value("creator")
            .and_then(|values| values.into_iter().find(|value| !value.trim().is_empty()));

        let mut chapters = Vec::new();
        for index in 0..doc.spine.len() {
            let Some((bytes, _mime)) = doc.navigate_by_spine_index(index) else {
                continue;
            };
            let html = String::from_utf8_lossy(&bytes);
            let text = html_to_text(&html);
            if text.trim().is_empty() {
                continue; // 封面、空白页之类的空章节直接跳过
            }
            chapters.push(EbookChapter { text });
        }

        if chapters.is_empty() {
            return Err(CommandError::new("EPUB 未提取到正文内容"));
        }

        Ok(EbookDocument {
            title,
            author,
            chapters,
        })
    });

    std::panic::set_hook(default_hook);

    match result {
        Ok(inner) => inner,
        Err(_) => {
            eprintln!("[ebook] lib-epub 对缺 id 的 EPUB 元数据 panic，已转为导入错误");
            Err(CommandError::new(
                "EPUB 元数据格式有误，无法导入（该文件的内容描述文件缺少必要属性）",
            ))
        }
    }
}

/// MOBI / AZW3：整个文档一次解压，无章节边界，标题/作者取元数据
fn parse_mobi(path: &Path) -> CommandResult<EbookDocument> {
    let book = mobi::Mobi::from_path(path)
        .map_err(|error| CommandError::new(format!("MOBI 解析失败：{error}")))?;

    let title = {
        let value = book.title();
        (!value.trim().is_empty()).then(|| value.trim().to_string())
    };
    let author = book
        .author()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let raw = book
        .content_as_string()
        .map_err(|error| CommandError::new(format!("MOBI 正文解压失败：{error}")))?;

    let text = html_to_text(&raw);
    if text.trim().is_empty() {
        return Err(CommandError::new("MOBI 未提取到正文内容"));
    }

    Ok(EbookDocument {
        title,
        author,
        chapters: vec![EbookChapter { text }],
    })
}

/// HTML → 纯文本（带 markdown 标题）。解析失败返回空串，由调用方按空章节处理。
fn html_to_text(html: &str) -> String {
    html2text::from_read(Cursor::new(html), HTML2TEXT_WIDTH).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    /// 手搓一个最小可用的 EPUB 2：mimetype + container + content.opf + toc.ncx + 一章 XHTML。
    fn build_epub() -> Vec<u8> {
        let mut buffer = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buffer));
            let stored = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
            let deflated = SimpleFileOptions::default();

            // EPUB 规范要求 mimetype 无压缩且位于第一个条目
            zip.start_file("mimetype", stored).unwrap();
            zip.write_all(b"application/epub+zip").unwrap();

            zip.start_file("META-INF/container.xml", deflated).unwrap();
            zip.write_all(
                br#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#,
            )
            .unwrap();

            zip.start_file("OEBPS/content.opf", deflated).unwrap();
            zip.write_all(
                br#"<?xml version="1.0"?>
<package version="2.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:test</dc:identifier>
    <dc:title>Test Book</dc:title>
    <dc:creator>Test Author</dc:creator>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="ch1"/>
  </spine>
</package>"#,
            )
            .unwrap();

            zip.start_file("OEBPS/toc.ncx", deflated).unwrap();
            zip.write_all(
                br#"<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:test"/>
  </head>
  <docTitle><text>Test Book</text></docTitle>
  <navMap>
    <navPoint id="navpoint-1" playOrder="1">
      <navLabel><text>Chapter One</text></navLabel>
      <content src="chapter1.xhtml"/>
    </navPoint>
  </navMap>
</ncx>"#,
            )
            .unwrap();

            zip.start_file("OEBPS/chapter1.xhtml", deflated).unwrap();
            zip.write_all(
                br#"<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Chapter One</title></head>
  <body>
    <h1>Chapter One</h1>
    <p>Hello NativeMind ebook world.</p>
  </body>
</html>"#,
            )
            .unwrap();

            zip.finish().unwrap();
        }
        buffer
    }

    #[test]
    fn extracts_epub_title_author_and_chapter() {
        let bytes = build_epub();
        let dir = std::env::temp_dir();
        let path = dir.join("nativemind_ebook_test.epub");
        std::fs::write(&path, &bytes).unwrap();

        let runtime = tokio::runtime::Builder::new_current_thread().build().unwrap();
        let document = runtime.block_on(extract(&path)).expect("EPUB 抽取应成功");
        std::fs::remove_file(&path).ok();

        assert_eq!(document.title.as_deref(), Some("Test Book"));
        assert_eq!(document.author.as_deref(), Some("Test Author"));
        assert_eq!(document.chapters.len(), 1);
        // html2text 把 <h1> 渲染成 markdown 标题，正文里的段落保留
        assert!(document.chapters[0].text.contains("# Chapter One"));
        assert!(document.chapters[0].text.contains("Hello NativeMind ebook world."));
    }

    #[test]
    fn missing_file_is_clear_error() {
        let runtime = tokio::runtime::Builder::new_current_thread().build().unwrap();
        let error = runtime
            .block_on(extract(&Path::new("no_such_file.epub")))
            .expect_err("文件不存在应报错");
        assert!(error.to_string().contains("不存在"));
    }

    /// 回归：lib-epub 0.3.1 对「EPUB 2.0 里缺 id 的 <meta> 标签」会在内部 unwrap panic
    /// （epub.rs:1154）。已用 vendor patch 修复（vendor/lib-epub），这里钉死：
    /// 这类常见的不规范文件必须能成功解析，而不是报错或 panic。
    #[test]
    fn epub2_meta_without_id_parses_successfully() {
        let mut buffer = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buffer));
            let stored = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
            let deflated = SimpleFileOptions::default();

            zip.start_file("mimetype", stored).unwrap();
            zip.write_all(b"application/epub+zip").unwrap();

            zip.start_file("META-INF/container.xml", deflated).unwrap();
            zip.write_all(
                br#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#,
            )
            .unwrap();

            // EPUB 2.0：<meta> 缺 id 属性（lib-epub 0.3.1 在这里 panic）
            zip.start_file("OEBPS/content.opf", deflated).unwrap();
            zip.write_all(
                br#"<?xml version="1.0"?>
<package version="2.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:test</dc:identifier>
    <dc:title>Test Book</dc:title>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="ch1"/>
  </spine>
</package>"#,
            )
            .unwrap();

            zip.start_file("OEBPS/chapter1.xhtml", deflated).unwrap();
            zip.write_all(
                br#"<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Chapter One</title></head>
  <body><p>Hello world.</p></body>
</html>"#,
            )
            .unwrap();

            zip.start_file("OEBPS/toc.ncx", deflated).unwrap();
            zip.write_all(
                br#"<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="navpoint-1" playOrder="1">
      <navLabel><text>Chapter One</text></navLabel>
      <content src="chapter1.xhtml"/>
    </navPoint>
  </navMap>
</ncx>"#,
            )
            .unwrap();

            zip.finish().unwrap();
        }

        let dir = std::env::temp_dir();
        let path = dir.join("nativemind_epub_bad_meta.epub");
        std::fs::write(&path, &buffer).unwrap();

        let runtime = tokio::runtime::Builder::new_current_thread().build().unwrap();
        let result = runtime.block_on(extract(&path));
        std::fs::remove_file(&path).ok();

        // vendor patch 已修复 lib-epub 0.3.1 的 unwrap bug：缺 id 的 <meta> 不再 panic，
        // 应成功解析出正文（标题、章节）。catch_unwind 仍是最后的防线（不 panic 冒出来）。
        let document = result.expect("缺 id 的 EPUB 2.0 应能成功解析");
        assert_eq!(document.title.as_deref(), Some("Test Book"));
        assert_eq!(document.chapters.len(), 1, "应提取到 1 章正文");
        assert!(document.chapters[0].text.contains("Hello world"));
    }

    /// 对真实 Z-Library 风格 EPUB 做冒烟验证：文件存在则必须能解析出正文（非空章节）。
    /// 通过环境变量 NATIVEMIND_TEST_EPUB 指定；未设置自动跳过（CI 上没有真实文件）。
    #[test]
    fn real_zlibrary_epub_parses() {
        let Ok(path) = std::env::var("NATIVEMIND_TEST_EPUB") else {
            eprintln!("未设置 NATIVEMIND_TEST_EPUB，跳过真实 EPUB 冒烟测试");
            return;
        };
        let runtime = tokio::runtime::Builder::new_current_thread().build().unwrap();
        let document = runtime
            .block_on(extract(Path::new(&path)))
            .unwrap_or_else(|error| panic!("真实 EPUB 解析失败: {error}"));
        assert!(
            !document.chapters.is_empty(),
            "应提取到至少一个非空章节"
        );
        let total: usize = document.chapters.iter().map(|c| c.text.len()).sum();
        assert!(total > 1000, "正文总量应明显大于 0（实际 {total} 字符）");
    }
}
