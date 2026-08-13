//! PDF 文本抽取
//!
//! 前端 `PdfParser` 把「抽文字」这一步抽象成了注入的 `PdfExtractor`，
//! 自己只做清洗、页眉页脚剔除、页码归属。这里就是那个 extractor 的宿主实现：
//! 返回**分页原文**，清洗留给 TS。
//!
//! 引擎用 pdf-extract（底层 lopdf），按页返回文本（`extract_text_by_pages`），
//! 页码由数组下标推导，保证和 PDF 的物理页一致。

use std::path::Path;

use serde::Serialize;

use crate::utils::{CommandError, CommandResult};

/// 单个 PDF 大小上限
///
/// 文本抽取要把整个文件读进来（含图像流），无上限的话一次误选几个 GB
/// 的扫描件会把内存打满。学习资料类 PDF 远到不了这个量级。
const MAX_PDF_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct PdfPage {
    pub page: u32,
    pub text: String,
}

#[derive(Debug, Serialize, Default)]
pub struct PdfMetadata {
    pub title: Option<String>,
    pub author: Option<String>,
}

/// 与前端 `PdfDocument` 结构对应
#[derive(Debug, Serialize)]
pub struct PdfDocument {
    pub pages: Vec<PdfPage>,
    pub metadata: PdfMetadata,
}

/// 抽取分页文本
///
/// 抽取是 CPU 密集操作，且对畸形文件可能行为异常，所以放进 blocking
/// 线程池：既不会卡住 async 主循环，一旦 panic 也只是这条命令失败，
/// 不会连带把整个 WebView 的 IPC 打断。
pub async fn extract(path: &Path) -> CommandResult<PdfDocument> {
    if !tokio::fs::try_exists(path).await.unwrap_or(false) {
        return Err(CommandError::new("PDF 文件不存在"));
    }

    let metadata = tokio::fs::metadata(path).await?;
    if metadata.len() > MAX_PDF_BYTES {
        return Err(CommandError::new(format!(
            "PDF 过大（{:.1} MB），上限 {} MB",
            metadata.len() as f64 / 1_048_576.0,
            MAX_PDF_BYTES / 1_048_576
        )));
    }

    let owned = path.to_path_buf();
    let pages_text = tokio::task::spawn_blocking(move || pdf_extract::extract_text_by_pages(&owned))
        .await
        .map_err(|_| CommandError::new("PDF 解析线程异常退出"))?
        .map_err(|error| CommandError::new(format!("PDF 解析失败：{error}")))?;

    let pages = pages_text
        .into_iter()
        .enumerate()
        .map(|(index, text)| PdfPage {
            page: (index + 1) as u32,
            // 每页 trim：pdf-extract 页首常带换行，留着会让前端把页眉误判成正文
            text: text.trim().to_string(),
        })
        .collect();

    // 元信息暂不抽取：pdf-extract 只提供 print_metadata（打到 stdout）。
    // 标题由前端从正文首行推断，够用；需要时再引入 lopdf 读 Info 字典。
    Ok(PdfDocument {
        pages,
        metadata: PdfMetadata::default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 追加一个对象并记录 xref 偏移
    fn push_obj(out: &mut Vec<u8>, offsets: &mut Vec<usize>, body: &str) {
        let num = offsets.len() + 1;
        offsets.push(out.len());
        out.extend_from_slice(format!("{num} 0 obj\n").as_bytes());
        out.extend_from_slice(body.as_bytes());
        out.extend_from_slice(b"\nendobj\n");
    }

    /// 手搓一个最小的单页 PDF，验证抽取链路真的能跑通。
    /// xref 偏移必须精确，否则 lopdf 拒绝加载。
    fn build_pdf(text: &str) -> Vec<u8> {
        let mut out: Vec<u8> = Vec::new();
        let mut offsets: Vec<usize> = Vec::new();

        out.extend_from_slice(b"%PDF-1.4\n");

        push_obj(&mut out, &mut offsets, "<< /Type /Catalog /Pages 2 0 R >>");
        push_obj(&mut out, &mut offsets, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
        push_obj(
            &mut out,
            &mut offsets,
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] \
             /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        );

        // 内容流：一行 Helvetica 文本
        let stream = format!("BT /F1 12 Tf 72 720 Td ({text}) Tj ET\n");
        push_obj(
            &mut out,
            &mut offsets,
            &format!("<< /Length {} >>\nstream\n{stream}endstream", stream.len()),
        );

        push_obj(
            &mut out,
            &mut offsets,
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        );

        let xref_offset = out.len();
        out.extend_from_slice(b"xref\n0 6\n");
        out.extend_from_slice(b"0000000000 65535 f \n");
        for offset in &offsets {
            out.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
        }
        out.extend_from_slice(
            format!("trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n")
                .as_bytes(),
        );

        out
    }

    #[test]
    fn extracts_pages_text() {
        let bytes = build_pdf("Hello NativeMind PDF");
        let dir = std::env::temp_dir();
        let path = dir.join("nativemind_pdf_test.pdf");
        std::fs::write(&path, &bytes).unwrap();

        let runtime = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        let document = runtime.block_on(extract(&path)).expect("PDF 抽取应成功");
        std::fs::remove_file(&path).ok();

        assert_eq!(document.pages.len(), 1);
        assert!(document.pages[0].text.contains("Hello NativeMind PDF"));
        assert_eq!(document.pages[0].page, 1);
    }

    #[test]
    fn missing_file_is_clear_error() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        let error = runtime
            .block_on(extract(&Path::new("no_such_file.pdf")))
            .expect_err("文件不存在应报错");
        assert!(error.to_string().contains("不存在"));
    }
}
