//! EPUB build functionality
//!
//! This module provides functionality for creating and building EPUB eBook files.
//! The `EpubBuilder` structure implements the build logic of the EPUB 3.0 specification,
//! allowing users to create standard-compliant EPUB files from scratch.
//!
//! ## Usage
//!
//! ```rust, no_run
//! # #[cfg(feature = "builder")] {
//! # fn main() -> Result<(), lib_epub::error::EpubError> {
//! use lib_epub::{
//!     builder::{EpubBuilder, EpubVersion3},
//!     types::{MetadataItem, ManifestItem, SpineItem},
//! };
//!
//! let mut builder = EpubBuilder::<EpubVersion3>::new()?;
//! builder
//!     .add_rootfile("OEBPS/content.opf")?
//!     .add_metadata(MetadataItem::new("title", "Test Book"))
//!     .add_manifest(
//!         "path/to/content",
//!         ManifestItem::new("content_id", "target/path")?,
//!     )?
//!     .add_spine(SpineItem::new("content.xhtml"));
//!
//! builder.build("output.epub")?;
//! # Ok(())
//! # }
//! # }
//! ```
//!
//! ## Notes
//!
//! - Requires `builder` feature to use this module.
//! - All resource files must exist on the local file system.
//! - At least one rootfile must be added before adding manifest items.
//! - Required metadata includes: `title`, `language`, and `identifier` with id `pub-id`.

use std::{
    cmp::Reverse,
    env,
    fs::{self, File},
    io::{BufReader, Cursor, Read, Seek},
    marker::PhantomData,
    path::{Path, PathBuf},
};

use log::warn;
use quick_xml::{
    Writer,
    events::{BytesDecl, BytesEnd, BytesStart, Event},
};
use walkdir::WalkDir;
use zip::{CompressionMethod, ZipWriter, write::FileOptions};

#[cfg(feature = "content-builder")]
use crate::builder::content::ContentBuilder;
use crate::{
    epub::EpubDoc,
    error::{EpubBuilderError, EpubError},
    types::{ManifestItem, MetadataItem, NavPoint, SpineItem},
    utils::{check_realtive_link_leakage, local_time, remove_leading_slash},
};

#[cfg(feature = "content-builder")]
pub mod content;

pub use components::CatalogBuilder;
#[cfg(feature = "content-builder")]
pub use components::DocumentBuilder;
pub use components::ManifestBuilder;
pub use components::MetadataBuilder;
pub use components::RootfileBuilder;
pub use components::SpineBuilder;

pub(crate) mod components;

type XmlWriter = Writer<Cursor<Vec<u8>>>;

// struct EpubVersion2;
#[cfg_attr(test, derive(Debug))]
pub struct EpubVersion3;

/// EPUB Builder
///
/// The main structure used to create and build EPUB ebook files.
/// Supports the EPUB 3.0 specification and can build a complete EPUB file structure.
///
/// ## Usage
///
/// ```rust, no_run
/// # #[cfg(feature = "builder")]
/// # fn main() -> Result<(), lib_epub::error::EpubError> {
/// use lib_epub::{
///     builder::{EpubBuilder, EpubVersion3},
///     types::{MetadataItem, ManifestItem, NavPoint, SpineItem},
/// };
///
/// let mut builder = EpubBuilder::<EpubVersion3>::new()?;
///
/// builder
///     .rootfile()
///     .add("EPUB/content.opf")?;
///
/// builder
///     .metadata()
///     .add(MetadataItem::new("title", "Test Book"))
///     .add(MetadataItem::new("language", "en"))
///     .add(
///         MetadataItem::new("identifier", "unique-id")
///             .with_id("pub-id")
///             .build(),
///     );
///
/// builder
///     .manifest()
///     .add(
///         "./test_case/Overview.xhtml",
///         ManifestItem::new("content", "target/path")?,
///     )?;
///
/// builder
///     .spine()
///     .add(SpineItem::new("content"));
///
/// builder
///     .catalog()
///     .set_title("Catalog Title")
///     .add(NavPoint::new("label"));
///
/// builder.build("output.epub")?;
///
/// # Ok(())
/// # }
/// ```
///
/// ## Notes
///
/// - All resource files **must** exist on the local file system.
/// - **At least one rootfile** must be added before adding manifest items.
/// - Requires at least one `title`, `language`, and `identifier` with id `pub-id`.
#[cfg_attr(test, derive(Debug))]
pub struct EpubBuilder<Version> {
    /// EPUB version placeholder
    epub_version: PhantomData<Version>,

    /// Temporary directory path for storing files during the build process
    pub(crate) temp_dir: PathBuf,

    pub(crate) rootfiles: RootfileBuilder,
    pub(crate) metadata: MetadataBuilder,
    pub(crate) manifest: ManifestBuilder,
    pub(crate) spine: SpineBuilder,
    pub(crate) catalog: CatalogBuilder,

    #[cfg(feature = "content-builder")]
    pub(crate) content: DocumentBuilder,
}

impl EpubBuilder<EpubVersion3> {
    /// Create a new `EpubBuilder` instance
    ///
    /// ## Return
    /// - `Ok(EpubBuilder)`: Builder instance created successfully
    /// - `Err(EpubError)`: Error occurred during builder initialization
    pub fn new() -> Result<Self, EpubError> {
        let temp_dir = env::temp_dir().join(local_time());
        fs::create_dir(&temp_dir)?;
        fs::create_dir(temp_dir.join("META-INF"))?;

        let mime_file = temp_dir.join("mimetype");
        fs::write(mime_file, "application/epub+zip")?;

        Ok(EpubBuilder {
            epub_version: PhantomData,
            temp_dir: temp_dir.clone(),

            rootfiles: RootfileBuilder::new(),
            metadata: MetadataBuilder::new(),
            manifest: ManifestBuilder::new(temp_dir),
            spine: SpineBuilder::new(),
            catalog: CatalogBuilder::new(),

            #[cfg(feature = "content-builder")]
            content: DocumentBuilder::new(),
        })
    }

    /// Add a rootfile path
    ///
    /// The added path points to an OPF file that does not yet exist
    /// and will be created when building the Epub file.
    ///
    /// ## Parameters
    /// - `rootfile`: Rootfile path
    ///
    /// ## Notes
    /// - The added rootfile path must be a relative path and cannot start with "../".
    /// - At least one rootfile must be added before adding metadata items.
    pub fn add_rootfile(&mut self, rootfile: impl AsRef<str>) -> Result<&mut Self, EpubError> {
        match self.rootfiles.add(rootfile) {
            Ok(_) => Ok(self),
            Err(err) => Err(err),
        }
    }

    /// Add metadata item
    ///
    /// Required metadata includes title, language, and an identifier with 'pub-id'.
    /// Missing this data will result in an error when building the epub file.
    ///
    /// ## Parameters
    /// - `item`: Metadata items to add
    pub fn add_metadata(&mut self, item: MetadataItem) -> &mut Self {
        let _ = self.metadata.add(item);
        self
    }

    /// Add manifest item and corresponding resource file
    ///
    /// The builder will automatically recognize the file type of
    /// the added resource and update it in `ManifestItem`.
    ///
    /// ## Parameters
    /// - `manifest_source` - Local resource file path
    /// - `manifest_item` - Manifest item information
    ///
    /// ## Return
    /// - `Ok(&mut Self)` - Successful addition, returns a reference to itself
    /// - `Err(EpubError)` - Error occurred during the addition process
    ///
    /// ## Notes
    /// - At least one rootfile must be added before adding manifest items.
    /// - If the manifest item ID already exists in the manifest, the manifest item will be overwritten.
    pub fn add_manifest(
        &mut self,
        manifest_source: impl Into<String>,
        manifest_item: ManifestItem,
    ) -> Result<&mut Self, EpubError> {
        if self.rootfiles.is_empty() {
            return Err(EpubBuilderError::MissingRootfile.into());
        } else {
            self.manifest
                .set_rootfile(self.rootfiles.first().expect("Unreachable"));
        }

        match self.manifest.add(manifest_source, manifest_item) {
            Ok(_) => Ok(self),
            Err(err) => Err(err),
        }
    }

    /// Add spine item
    ///
    /// The spine item defines the reading order of the book.
    ///
    /// ## Parameters
    /// - `item`: Spine item to add
    pub fn add_spine(&mut self, item: SpineItem) -> &mut Self {
        self.spine.add(item);
        self
    }

    /// Set catalog title
    ///
    /// ## Parameters
    /// - `title`: Catalog title
    pub fn set_catalog_title(&mut self, title: impl Into<String>) -> &mut Self {
        let _ = self.catalog.set_title(title);
        self
    }

    /// Add catalog item
    ///
    /// Added directory items will be added to the end of the existing list.
    ///
    /// ## Parameters
    /// - `item`: Catalog item to add
    pub fn add_catalog_item(&mut self, item: NavPoint) -> &mut Self {
        let _ = self.catalog.add(item);
        self
    }

    /// Add content
    ///
    /// The content builder can be used to generate content for the book.
    /// It is recommended to use the `content-builder` feature to use this function.
    ///
    /// ## Parameters
    /// - `target_path`: The path to the resource file within the EPUB container
    /// - `content`: The content builder to generate content
    #[cfg(feature = "content-builder")]
    pub fn add_content(
        &mut self,
        target_path: impl AsRef<str>,
        content: ContentBuilder,
    ) -> &mut Self {
        self.content.add(target_path, content);
        self
    }

    /// Clear all data from the builder
    ///
    /// This function clears all metadata, manifest items, spine items, catalog items, etc.
    /// from the builder, effectively resetting it to an empty state.
    ///
    /// ## Return
    /// - `Ok(&mut Self)`: Successfully cleared all data
    /// - `Err(EpubError)`: Error occurred during the clearing process (specifically during manifest clearing)
    pub fn clear_all(&mut self) -> &mut Self {
        self.rootfiles.clear();
        self.metadata.clear();
        self.manifest.clear();
        self.spine.clear();
        self.catalog.clear();
        #[cfg(feature = "content-builder")]
        self.content.clear();

        self
    }

    /// Get a mutable reference to the rootfile builder
    ///
    /// Allows direct manipulation of rootfile entries.
    ///
    /// ## Return
    /// - `&mut RootfileBuilder`: Mutable reference to the rootfile builder
    pub fn rootfile(&mut self) -> &mut RootfileBuilder {
        &mut self.rootfiles
    }

    /// Get a mutable reference to the metadata builder
    ///
    /// Allows direct manipulation of metadata items.
    ///
    /// ## Return
    /// - `&mut MetadataBuilder`: Mutable reference to the metadata builder
    pub fn metadata(&mut self) -> &mut MetadataBuilder {
        &mut self.metadata
    }

    /// Get a mutable reference to the manifest builder
    ///
    /// Allows direct manipulation of manifest items.
    ///
    /// ## Return
    /// - `&mut ManifestBuilder`: Mutable reference to the manifest builder
    pub fn manifest(&mut self) -> &mut ManifestBuilder {
        &mut self.manifest
    }

    /// Get a mutable reference to the spine builder
    ///
    /// Allows direct manipulation of spine items.
    ///
    /// ## Return
    /// - `&mut SpineBuilder`: Mutable reference to the spine builder
    pub fn spine(&mut self) -> &mut SpineBuilder {
        &mut self.spine
    }

    /// Get a mutable reference to the catalog builder
    ///
    /// Allows direct manipulation of navigation/catalog items.
    ///
    /// ## Return
    /// - `&mut CatalogBuilder`: Mutable reference to the catalog builder
    pub fn catalog(&mut self) -> &mut CatalogBuilder {
        &mut self.catalog
    }

    /// Get a mutable reference to the content builder
    ///
    /// Allows direct manipulation of content documents.
    ///
    /// ## Return
    /// - `&mut DocumentBuilder`: Mutable reference to the document builder
    #[cfg(feature = "content-builder")]
    pub fn content(&mut self) -> &mut DocumentBuilder {
        &mut self.content
    }

    /// Builds an EPUB file and saves it to the specified path
    ///
    /// ## Parameters
    /// - `output_path`: Output file path
    ///
    /// ## Return
    /// - `Ok(())`: Build successful
    /// - `Err(EpubError)`: Error occurred during the build process
    pub fn make(mut self, output_path: impl AsRef<Path>) -> Result<(), EpubError> {
        // Create the container.xml, navigation document, and OPF files in sequence.
        // The associated metadata will initialized when navigation document is created;
        // therefore, the navigation document must be created before the opf file is created.
        self.make_container_xml()?;
        self.make_navigation_document()?;
        #[cfg(feature = "content-builder")]
        self.make_contents()?;
        self.make_opf_file()?;
        self.remove_empty_dirs()?;

        if let Some(parent) = output_path.as_ref().parent() {
            if !parent.exists() {
                fs::create_dir_all(parent)?;
            }
        }

        // pack zip file
        let file = File::create(output_path)?;
        let mut zip = ZipWriter::new(file);
        let options = FileOptions::<()>::default().compression_method(CompressionMethod::Stored);

        for entry in WalkDir::new(&self.temp_dir) {
            let entry = entry?;
            let path = entry.path();

            // It can be asserted that the path is prefixed with temp_dir,
            // and there will be no boundary cases of symbolic links and hard links, etc.
            let relative_path = path.strip_prefix(&self.temp_dir).unwrap();
            let target_path = relative_path.to_string_lossy().replace("\\", "/");

            if path.is_file() {
                zip.start_file(target_path, options)?;

                let mut file = File::open(path)?;
                std::io::copy(&mut file, &mut zip)?;
            } else if path.is_dir() {
                zip.add_directory(target_path, options)?;
            }
        }

        zip.finish()?;
        Ok(())
    }

    /// Builds an EPUB file and returns a `EpubDoc`
    ///
    /// Builds an EPUB file at the specified location and parses it into a usable EpubDoc object.
    ///
    /// ## Parameters
    /// - `output_path`: Output file path
    ///
    /// ## Return
    /// - `Ok(EpubDoc)`: Build successful
    /// - `Err(EpubError)`: Error occurred during the build process
    pub fn build(
        self,
        output_path: impl AsRef<Path>,
    ) -> Result<EpubDoc<BufReader<File>>, EpubError> {
        self.make(&output_path)?;

        EpubDoc::new(output_path)
    }

    /// Creates an `EpubBuilder` instance from an existing `EpubDoc`
    ///
    /// This function takes an existing parsed EPUB document and creates a new builder
    /// instance with all the document's metadata, manifest items, spine, and catalog information.
    /// It essentially reverses the EPUB building process by extracting all the necessary
    /// components from the parsed document and preparing them for reconstruction.
    ///
    /// The function copies the following information from the provided `EpubDoc`:
    /// - Rootfile path (based on the document's base path)
    /// - All metadata items (title, author, identifier, etc.)
    /// - Spine items (reading order of the publication)
    /// - Catalog information (navigation points)
    /// - Catalog title
    /// - All manifest items (except those with 'nav' property, which are skipped)
    ///
    /// ## Parameters
    /// - `doc`: A mutable reference to an `EpubDoc` instance that contains the parsed EPUB data
    ///
    /// ## Return
    /// - `Ok(EpubBuilder)`: Successfully created builder instance populated with the document's data
    /// - `Err(EpubError)`: Error occurred during the extraction process
    ///
    /// ## Notes
    /// - This type of conversion will upgrade Epub2.x publications to Epub3.x.
    ///   This upgrade conversion may encounter unknown errors (it is unclear whether
    ///   it will cause errors), so please use it with caution.
    pub fn from<R: Read + Seek + Send>(doc: &mut EpubDoc<R>) -> Result<Self, EpubError> {
        let mut builder = Self::new()?;

        builder.add_rootfile(doc.package_path.clone().to_string_lossy())?;
        builder.metadata.metadata = doc.metadata.clone();
        builder.spine.spine = doc.spine.clone();
        builder.catalog.catalog = doc.catalog.clone();
        builder.catalog.title = doc.catalog_title.clone();

        // clone manifest hashmap to avoid mut borrow conflict
        for (_, mut manifest) in doc.manifest.clone().into_iter() {
            if let Some(properties) = &manifest.properties {
                if properties.contains("nav") {
                    continue;
                }
            }

            // because manifest paths in EpubDoc are converted to absolute paths rooted in containers,
            // but in the form of 'path/to/manifest', they need to be converted here to absolute paths
            // in the form of '/path/to/manifest'.
            manifest.path = PathBuf::from("/").join(manifest.path);

            let (buf, _) = doc.get_manifest_item(&manifest.id)?; // read raw file
            let target_path = normalize_manifest_path(
                &builder.temp_dir,
                builder.rootfiles.first().expect("Unreachable"),
                &manifest.path,
                &manifest.id,
            )?;
            if let Some(parent_dir) = target_path.parent() {
                if !parent_dir.exists() {
                    fs::create_dir_all(parent_dir)?
                }
            }

            fs::write(target_path, buf)?;
            builder
                .manifest
                .manifest
                .insert(manifest.id.clone(), manifest);
        }

        Ok(builder)
    }

    /// Creates the `container.xml` file
    ///
    /// An error will occur if the `rootfile` path is not set
    fn make_container_xml(&self) -> Result<(), EpubError> {
        if self.rootfiles.is_empty() {
            return Err(EpubBuilderError::MissingRootfile.into());
        }

        let mut writer = Writer::new(Cursor::new(Vec::new()));
        self.rootfiles.make(&mut writer)?;

        let file_path = self.temp_dir.join("META-INF").join("container.xml");
        let file_data = writer.into_inner().into_inner();
        fs::write(file_path, file_data)?;

        Ok(())
    }

    /// Creates the content document
    #[cfg(feature = "content-builder")]
    fn make_contents(&mut self) -> Result<(), EpubError> {
        let manifest_list = self.content.make(
            self.temp_dir.clone(),
            self.rootfiles.first().expect("Unreachable"),
        )?;

        for item in manifest_list.into_iter() {
            self.manifest.insert(item.id.clone(), item);
        }

        Ok(())
    }

    /// Creates the `navigation document`
    ///
    /// An error will occur if navigation information is not initialized.
    fn make_navigation_document(&mut self) -> Result<(), EpubError> {
        if self.catalog.is_empty() {
            return Err(EpubBuilderError::NavigationInfoUninitalized.into());
        }

        let mut writer = Writer::new(Cursor::new(Vec::new()));
        self.catalog.make(&mut writer)?;

        let file_path = self.temp_dir.join("nav.xhtml");
        let file_data = writer.into_inner().into_inner();
        fs::write(file_path, file_data)?;

        self.manifest.insert(
            "nav".to_string(),
            ManifestItem {
                id: "nav".to_string(),
                path: PathBuf::from("/nav.xhtml"),
                mime: "application/xhtml+xml".to_string(),
                properties: Some("nav".to_string()),
                fallback: None,
            },
        );

        Ok(())
    }

    /// Creates the `OPF` file
    ///
    /// ## Error conditions
    /// - Missing necessary metadata
    /// - Circular reference exists in the manifest backlink
    /// - Navigation information is not initialized
    fn make_opf_file(&mut self) -> Result<(), EpubError> {
        self.metadata.validate()?;
        self.manifest.validate()?;
        self.spine.validate(self.manifest.keys())?;

        let mut writer = Writer::new(Cursor::new(Vec::new()));

        writer.write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))?;

        writer.write_event(Event::Start(BytesStart::new("package").with_attributes([
            ("xmlns", "http://www.idpf.org/2007/opf"),
            ("xmlns:dc", "http://purl.org/dc/elements/1.1/"),
            ("unique-identifier", "pub-id"),
            ("version", "3.0"),
        ])))?;

        self.metadata.make(&mut writer)?;
        self.manifest.make(&mut writer)?;
        self.spine.make(&mut writer)?;

        writer.write_event(Event::End(BytesEnd::new("package")))?;

        let file_path = self
            .temp_dir
            .join(self.rootfiles.first().expect("Unreachable"));
        let file_data = writer.into_inner().into_inner();
        fs::write(file_path, file_data)?;

        Ok(())
    }

    /// Remove empty directories under the builder temporary directory
    ///
    /// By enumerate directories under `self.temp_dir` (excluding the root itself)
    /// and deletes directories that are empty. Directories are processed from deepest
    /// to shallowest so that parent directories which become empty after child
    /// deletion can also be removed.
    ///
    /// ## Return
    /// - `Ok(())`: Successfully removed all empty directories
    /// - `Err(EpubError)`: IO error
    fn remove_empty_dirs(&self) -> Result<(), EpubError> {
        let mut dirs = WalkDir::new(self.temp_dir.as_path())
            .min_depth(1)
            .into_iter()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_type().is_dir())
            .map(|entry| entry.into_path())
            .collect::<Vec<PathBuf>>();

        dirs.sort_by_key(|p| Reverse(p.components().count()));

        for dir in dirs {
            if fs::read_dir(&dir)?.next().is_none() {
                fs::remove_dir(dir)?;
            }
        }

        Ok(())
    }
}

impl<Version> Drop for EpubBuilder<Version> {
    /// Remove temporary directory when dropped
    fn drop(&mut self) {
        if let Err(err) = fs::remove_dir_all(&self.temp_dir) {
            warn!("{}", err);
        };
    }
}

/// Refine the MIME type based on file extension
///
/// This function optimizes MIME types that are inferred from file content by using
/// the file extension to determine the correct EPUB-specific MIME type. Some file
/// types have different MIME types depending on how they are used in an EPUB context.
fn refine_mime_type<'a>(infer_mime: &'a str, extension: &'a str) -> &'a str {
    match (infer_mime, extension) {
        ("text/xml", "xhtml")
        | ("application/xml", "xhtml")
        | ("text/xml", "xht")
        | ("application/xml", "xht") => "application/xhtml+xml",

        ("text/xml", "opf") | ("application/xml", "opf") => "application/oebps-package+xml",

        ("text/xml", "ncx") | ("application/xml", "ncx") => "application/x-dtbncx+xml",

        ("application/zip", "epub") => "application/epub+zip",

        ("text/plain", "css") => "text/css",
        ("text/plain", "js") => "application/javascript",
        ("text/plain", "json") => "application/json",
        ("text/plain", "svg") => "image/svg+xml",

        _ => infer_mime,
    }
}

/// Normalize manifest path to absolute path within EPUB container
///
/// This function takes a path (relative or absolute) and normalizes it to an absolute
/// path within the EPUB container structure. It handles various path formats including:
/// - Relative paths starting with "../" (with security check to prevent directory traversal)
/// - Absolute paths starting with "/" (relative to EPUB root)
/// - Relative paths starting with "./" (current directory)
/// - Plain relative paths (relative to the OPF file location)
///
/// ## Parameters
/// - `temp_dir`: The temporary directory path used during the EPUB build process
/// - `rootfile`: The path to the OPF file (package document), used to determine the base directory
/// - `path`: The input path that may be relative or absolute. Can be any type that
///   implements `AsRef<Path>`, such as `&str`, `String`, `Path`, `PathBuf`, etc.
/// - `id`: The identifier of the manifest item being processed
///
/// ## Return
/// - `Ok(PathBuf)`: The normalized absolute path within the EPUB container,
///   which does not start with "/"
/// - `Err(EpubError)`: Error if path traversal is detected outside the EPUB container,
///   or if the absolute path cannot be determined
fn normalize_manifest_path<TempD: AsRef<Path>, S: AsRef<str>, P: AsRef<Path>>(
    temp_dir: TempD,
    rootfile: S,
    path: P,
    id: &str,
) -> Result<PathBuf, EpubError> {
    let opf_path = PathBuf::from(rootfile.as_ref());
    let basic_path = remove_leading_slash(opf_path.parent().unwrap());

    // convert manifest path to absolute path(physical path)
    let target_path = if path.as_ref().starts_with("../") {
        check_realtive_link_leakage(
            temp_dir.as_ref().to_path_buf(),
            basic_path.to_path_buf(),
            &path.as_ref().to_string_lossy(),
        )
        .map(PathBuf::from)
        .ok_or_else(|| EpubError::RelativeLinkLeakage {
            path: path.as_ref().to_string_lossy().to_string(),
        })?
    } else if let Ok(stripped) = path.as_ref().strip_prefix("/") {
        temp_dir.as_ref().join(stripped)
    } else if path.as_ref().starts_with("./") {
        // can not anlyze where the 'current' directory is
        Err(EpubBuilderError::IllegalManifestPath { manifest_id: id.to_string() })?
    } else {
        temp_dir.as_ref().join(basic_path).join(path)
    };

    #[cfg(windows)]
    let target_path = PathBuf::from(target_path.to_string_lossy().replace('\\', "/"));

    Ok(target_path)
}

#[cfg(test)]
mod tests {
    use std::{env, fs, path::PathBuf};

    use crate::{
        builder::{EpubBuilder, EpubVersion3, normalize_manifest_path, refine_mime_type},
        epub::EpubDoc,
        error::{EpubBuilderError, EpubError},
        types::{ManifestItem, MetadataItem, NavPoint, SpineItem},
        utils::local_time,
    };

    mod test_helpers {
        use super::*;

        pub(super) fn create_basic_builder() -> EpubBuilder<EpubVersion3> {
            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();
            builder.add_rootfile("content.opf").unwrap();
            builder.add_metadata(MetadataItem::new("title", "Test Book"));
            builder.add_metadata(MetadataItem::new("language", "en"));
            builder.add_metadata(
                MetadataItem::new("identifier", "urn:isbn:1234567890")
                    .with_id("pub-id")
                    .build(),
            );
            builder
        }

        pub(super) fn create_full_builder() -> EpubBuilder<EpubVersion3> {
            let mut builder = create_basic_builder();
            builder.add_catalog_item(NavPoint::new("Chapter"));
            builder.add_spine(SpineItem::new("test"));
            builder
        }
    }

    mod epub_builder_tests {
        use super::*;

        #[test]
        fn test_epub_builder_new() {
            let builder = EpubBuilder::<EpubVersion3>::new().expect("Failed to create builder");
            assert!(builder.temp_dir.exists());
            assert!(builder.rootfiles.is_empty());
            assert!(builder.metadata.metadata.is_empty());
            assert!(builder.manifest.manifest.is_empty());
            assert!(builder.spine.spine.is_empty());
            assert!(builder.catalog.title.is_empty());
            assert!(builder.catalog.is_empty());
        }

        #[test]
        fn test_add_rootfile() {
            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();

            builder
                .add_rootfile("content.opf")
                .expect("Failed to add rootfile");
            assert_eq!(builder.rootfiles.rootfiles.len(), 1);
            assert_eq!(builder.rootfiles.rootfiles[0], "content.opf");

            builder
                .add_rootfile("./another.opf")
                .expect("Failed to add another rootfile");
            assert_eq!(builder.rootfiles.rootfiles.len(), 2);
            assert_eq!(
                builder.rootfiles.rootfiles,
                vec!["content.opf", "another.opf"]
            );
        }

        #[test]
        fn test_add_rootfile_fail() {
            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();

            let result = builder.add_rootfile("/rootfile.opf");
            assert!(result.is_err());
            assert_eq!(
                result.unwrap_err(),
                EpubBuilderError::IllegalRootfilePath.into()
            );

            let result = builder.add_rootfile("../rootfile.opf");
            assert!(result.is_err());
            assert_eq!(
                result.unwrap_err(),
                EpubBuilderError::IllegalRootfilePath.into()
            );
        }

        #[test]
        fn test_add_metadata() {
            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();
            let metadata_item = MetadataItem::new("title", "Test Book");

            builder.add_metadata(metadata_item);

            assert_eq!(builder.metadata.metadata.len(), 1);
            assert_eq!(builder.metadata.metadata[0].property, "title");
            assert_eq!(builder.metadata.metadata[0].value, "Test Book");
        }

        #[test]
        fn test_add_spine() {
            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();
            let spine_item = SpineItem::new("test_item");

            builder.add_spine(spine_item);

            assert_eq!(builder.spine.spine.len(), 1);
            assert_eq!(builder.spine.spine[0].idref, "test_item");
        }

        #[test]
        fn test_set_catalog_title() {
            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();
            let title = "Test Catalog Title";

            builder.set_catalog_title(title);

            assert_eq!(builder.catalog.title, title);
        }

        #[test]
        fn test_add_catalog_item() {
            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();
            let nav_point = NavPoint::new("Chapter 1");

            builder.add_catalog_item(nav_point);

            assert_eq!(builder.catalog.catalog.len(), 1);
            assert_eq!(builder.catalog.catalog[0].label, "Chapter 1");
        }

        #[test]
        fn test_clear_all() {
            let mut builder = test_helpers::create_full_builder();

            assert_eq!(builder.metadata.metadata.len(), 3);
            assert_eq!(builder.spine.spine.len(), 1);
            assert_eq!(builder.catalog.catalog.len(), 1);

            builder.clear_all();

            assert!(builder.metadata.metadata.is_empty());
            assert!(builder.spine.spine.is_empty());
            assert!(builder.catalog.catalog.is_empty());
            assert!(builder.catalog.title.is_empty());
            assert!(builder.manifest.manifest.is_empty());

            builder.add_metadata(MetadataItem::new("title", "New Book"));
            builder.add_spine(SpineItem::new("new_chapter"));
            builder.add_catalog_item(NavPoint::new("New Chapter"));

            assert_eq!(builder.metadata.metadata.len(), 1);
            assert_eq!(builder.spine.spine.len(), 1);
            assert_eq!(builder.catalog.catalog.len(), 1);
        }

        #[test]
        fn test_make() {
            let mut builder = test_helpers::create_full_builder();

            builder
                .add_manifest(
                    "./test_case/Overview.xhtml",
                    ManifestItem {
                        id: "test".to_string(),
                        path: PathBuf::from("test.xhtml"),
                        mime: String::new(),
                        properties: None,
                        fallback: None,
                    },
                )
                .unwrap();

            let file = env::temp_dir().join(format!("{}.epub", local_time()));
            assert!(builder.make(&file).is_ok());
            assert!(EpubDoc::new(&file).is_ok());
        }

        #[test]
        fn test_build() {
            let mut builder = test_helpers::create_full_builder();

            builder
                .add_manifest(
                    "./test_case/Overview.xhtml",
                    ManifestItem {
                        id: "test".to_string(),
                        path: PathBuf::from("test.xhtml"),
                        mime: String::new(),
                        properties: None,
                        fallback: None,
                    },
                )
                .unwrap();

            let file = env::temp_dir().join(format!("{}.epub", local_time()));
            assert!(builder.build(&file).is_ok());
        }

        #[test]
        fn test_from() {
            let metadata = vec![
                MetadataItem {
                    id: None,
                    property: "title".to_string(),
                    value: "Test Book".to_string(),
                    lang: None,
                    refined: vec![],
                },
                MetadataItem {
                    id: None,
                    property: "language".to_string(),
                    value: "en".to_string(),
                    lang: None,
                    refined: vec![],
                },
                MetadataItem {
                    id: Some("pub-id".to_string()),
                    property: "identifier".to_string(),
                    value: "test-book".to_string(),
                    lang: None,
                    refined: vec![],
                },
            ];
            let spine = vec![SpineItem {
                id: None,
                idref: "main".to_string(),
                linear: true,
                properties: None,
            }];
            let catalog = vec![
                NavPoint {
                    label: "Nav".to_string(),
                    content: None,
                    children: vec![],
                    play_order: None,
                },
                NavPoint {
                    label: "Overview".to_string(),
                    content: None,
                    children: vec![],
                    play_order: None,
                },
            ];

            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();
            builder.add_rootfile("content.opf").unwrap();
            builder.metadata.metadata = metadata.clone();
            builder.spine.spine = spine.clone();
            builder.catalog.catalog = catalog.clone();
            builder.set_catalog_title("catalog title");
            builder
                .add_manifest(
                    "./test_case/Overview.xhtml",
                    ManifestItem {
                        id: "main".to_string(),
                        path: PathBuf::from("Overview.xhtml"),
                        mime: String::new(),
                        properties: None,
                        fallback: None,
                    },
                )
                .unwrap();

            let epub_file = env::temp_dir().join(format!("{}.epub", local_time()));
            builder.make(&epub_file).unwrap();

            let mut doc = EpubDoc::new(&epub_file).unwrap();
            let builder = EpubBuilder::from(&mut doc).unwrap();

            assert_eq!(builder.metadata.metadata.len(), metadata.len() + 1);
            assert_eq!(builder.manifest.manifest.len(), 1);
            assert_eq!(builder.spine.spine.len(), spine.len());
            assert_eq!(builder.catalog.catalog, catalog);
            assert_eq!(builder.catalog.title, "catalog title");
        }

        #[test]
        fn test_make_container_file() {
            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();

            let result = builder.make_container_xml();
            assert!(result.is_err());
            assert_eq!(
                result.unwrap_err(),
                EpubBuilderError::MissingRootfile.into()
            );

            builder.add_rootfile("content.opf").unwrap();
            assert!(builder.make_container_xml().is_ok());
        }

        #[test]
        fn test_make_navigation_document() {
            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();

            let result = builder.make_navigation_document();
            assert!(result.is_err());
            assert_eq!(
                result.unwrap_err(),
                EpubBuilderError::NavigationInfoUninitalized.into()
            );

            builder.add_catalog_item(NavPoint::new("test"));
            assert!(builder.make_navigation_document().is_ok());
        }

        #[test]
        fn test_make_opf_file_success() {
            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();

            builder.add_rootfile("content.opf").unwrap();
            builder.add_metadata(MetadataItem::new("title", "Test Book"));
            builder.add_metadata(MetadataItem::new("language", "en"));
            builder.add_metadata(
                MetadataItem::new("identifier", "urn:isbn:1234567890")
                    .with_id("pub-id")
                    .build(),
            );

            let test_file = builder.temp_dir.join("test.xhtml");
            fs::write(&test_file, "<html></html>").unwrap();
            builder
                .add_manifest(
                    test_file.to_str().unwrap(),
                    ManifestItem::new("test", "test.xhtml").unwrap(),
                )
                .unwrap();

            builder.add_catalog_item(NavPoint::new("Chapter"));
            builder.add_spine(SpineItem::new("test"));
            builder.make_navigation_document().unwrap();

            assert!(builder.make_opf_file().is_ok());
            assert!(builder.temp_dir.join("content.opf").exists());
        }

        #[test]
        fn test_make_opf_file_missing_metadata() {
            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();
            builder.add_rootfile("content.opf").unwrap();

            let result = builder.make_opf_file();
            assert!(result.is_err());
            assert_eq!(
                result.unwrap_err().to_string(),
                "Epub builder error: Requires at least one 'title', 'language', and 'identifier' with id 'pub-id'."
            );
        }
    }

    mod manifest_tests {
        use super::*;

        #[test]
        fn test_add_manifest_success() {
            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();
            builder.add_rootfile("content.opf").unwrap();

            let test_file = builder.temp_dir.join("test.xhtml");
            fs::write(&test_file, "<html><body>Hello World</body></html>").unwrap();

            let manifest_item = ManifestItem::new("test", "/epub/test.xhtml").unwrap();
            let result = builder.add_manifest(test_file.to_str().unwrap(), manifest_item);

            assert!(result.is_ok(), "Failed to add manifest: {:?}", result.err());
            assert_eq!(builder.manifest.manifest.len(), 1);
            assert!(builder.manifest.manifest.contains_key("test"));
        }

        #[test]
        fn test_add_manifest_no_rootfile() {
            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();

            let manifest_item = ManifestItem {
                id: "main".to_string(),
                path: PathBuf::from("/Overview.xhtml"),
                mime: String::new(),
                properties: None,
                fallback: None,
            };

            let result = builder.add_manifest("./test_case/Overview.xhtml", manifest_item.clone());
            assert!(result.is_err());
            assert_eq!(
                result.unwrap_err(),
                EpubBuilderError::MissingRootfile.into()
            );

            builder.add_rootfile("package.opf").unwrap();
            let result = builder.add_manifest("./test_case/Overview.xhtml", manifest_item);
            assert!(result.is_ok());
        }

        #[test]
        fn test_add_manifest_nonexistent_file() {
            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();
            builder.add_rootfile("content.opf").unwrap();

            let manifest_item = ManifestItem::new("test", "nonexistent.xhtml").unwrap();
            let result = builder.add_manifest("nonexistent.xhtml", manifest_item);

            assert!(result.is_err());
            assert_eq!(
                result.unwrap_err(),
                EpubBuilderError::TargetIsNotFile {
                    target_path: "nonexistent.xhtml".to_string()
                }
                .into()
            );
        }

        #[test]
        fn test_add_manifest_unknown_file_format() {
            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();
            builder.add_rootfile("package.opf").unwrap();

            let result = builder.add_manifest(
                "./test_case/unknown_file_format.xhtml",
                ManifestItem {
                    id: "file".to_string(),
                    path: PathBuf::from("unknown_file_format.xhtml"),
                    mime: String::new(),
                    properties: None,
                    fallback: None,
                },
            );

            assert!(result.is_err());
            assert_eq!(
                result.unwrap_err(),
                EpubBuilderError::UnknownFileFormat {
                    file_path: "./test_case/unknown_file_format.xhtml".to_string(),
                }
                .into()
            );
        }

        #[test]
        fn test_validate_fallback_chain_valid() {
            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();

            let item3 = ManifestItem::new("item3", "path3").unwrap();
            let item2 = ManifestItem::new("item2", "path2")
                .unwrap()
                .with_fallback("item3")
                .build();
            let item1 = ManifestItem::new("item1", "path1")
                .unwrap()
                .with_fallback("item2")
                .append_property("nav")
                .build();

            builder.manifest.insert("item3".to_string(), item3);
            builder.manifest.insert("item2".to_string(), item2);
            builder.manifest.insert("item1".to_string(), item1);

            assert!(builder.manifest.validate().is_ok());
        }

        #[test]
        fn test_validate_fallback_chain_circular_reference() {
            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();

            let item2 = ManifestItem::new("item2", "path2")
                .unwrap()
                .with_fallback("item1")
                .build();
            let item1 = ManifestItem::new("item1", "path1")
                .unwrap()
                .with_fallback("item2")
                .build();

            builder.manifest.insert("item1".to_string(), item1);
            builder.manifest.insert("item2".to_string(), item2);

            let result = builder.manifest.validate();
            assert!(result.is_err());
            assert!(result.unwrap_err().to_string().starts_with(
                "Epub builder error: Circular reference detected in fallback chain for"
            ));
        }

        #[test]
        fn test_validate_fallback_chain_not_found() {
            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();

            let item1 = ManifestItem::new("item1", "path1")
                .unwrap()
                .with_fallback("nonexistent")
                .build();

            builder.manifest.insert("item1".to_string(), item1);

            let result = builder.manifest.validate();
            assert!(result.is_err());
            assert_eq!(
                result.unwrap_err().to_string(),
                "Epub builder error: Fallback resource 'nonexistent' does not exist in manifest."
            );
        }

        #[test]
        fn test_validate_manifest_nav_single() {
            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();

            let nav_item = ManifestItem::new("nav", "nav.xhtml")
                .unwrap()
                .append_property("nav")
                .build();
            builder
                .manifest
                .manifest
                .insert("nav".to_string(), nav_item);

            assert!(builder.manifest.validate().is_ok());
        }

        #[test]
        fn test_validate_manifest_nav_multiple() {
            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();

            let nav_item1 = ManifestItem::new("nav1", "nav1.xhtml")
                .unwrap()
                .append_property("nav")
                .build();
            let nav_item2 = ManifestItem::new("nav2", "nav2.xhtml")
                .unwrap()
                .append_property("nav")
                .build();

            builder
                .manifest
                .manifest
                .insert("nav1".to_string(), nav_item1);
            builder
                .manifest
                .manifest
                .insert("nav2".to_string(), nav_item2);

            let result = builder.manifest.validate();
            assert!(result.is_err());
            assert_eq!(
                result.unwrap_err().to_string(),
                "Epub builder error: There are too many items with 'nav' property in the manifest."
            );
        }
    }

    mod metadata_tests {
        use super::*;

        #[test]
        fn test_validate_metadata_success() {
            let builder = test_helpers::create_basic_builder();
            assert!(builder.metadata.validate().is_ok());
        }

        #[test]
        fn test_validate_metadata_missing_required() {
            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();
            builder.add_metadata(MetadataItem::new("title", "Test Book"));
            builder.add_metadata(MetadataItem::new("language", "en"));
            assert!(builder.metadata.validate().is_err());
        }
    }

    mod utility_tests {
        use super::*;

        #[test]
        fn test_normalize_manifest_path() {
            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();
            builder.add_rootfile("content.opf").unwrap();

            let result = normalize_manifest_path(
                &builder.temp_dir,
                builder.rootfiles.first().unwrap(),
                "../../test.xhtml",
                "id",
            );
            assert!(result.is_err());
            assert_eq!(
                result.unwrap_err(),
                EpubError::RelativeLinkLeakage { path: "../../test.xhtml".to_string() }
            );

            let result = normalize_manifest_path(
                &builder.temp_dir,
                builder.rootfiles.first().unwrap(),
                "/test.xhtml",
                "id",
            );
            assert!(result.is_ok());
            assert_eq!(result.unwrap(), builder.temp_dir.join("test.xhtml"));

            let result = normalize_manifest_path(
                &builder.temp_dir,
                builder.rootfiles.first().unwrap(),
                "./test.xhtml",
                "manifest_id",
            );
            assert!(result.is_err());
            assert_eq!(
                result.unwrap_err(),
                EpubBuilderError::IllegalManifestPath { manifest_id: "manifest_id".to_string() }
                    .into(),
            );
        }

        #[test]
        fn test_refine_mime_type() {
            assert_eq!(
                refine_mime_type("text/xml", "xhtml"),
                "application/xhtml+xml"
            );
            assert_eq!(refine_mime_type("text/xml", "xht"), "application/xhtml+xml");
            assert_eq!(
                refine_mime_type("application/xml", "opf"),
                "application/oebps-package+xml"
            );
            assert_eq!(
                refine_mime_type("text/xml", "ncx"),
                "application/x-dtbncx+xml"
            );
            assert_eq!(refine_mime_type("text/plain", "css"), "text/css");
            assert_eq!(refine_mime_type("text/plain", "unknown"), "text/plain");
        }
    }

    #[cfg(feature = "content-builder")]
    mod content_builder_tests {
        use crate::builder::{EpubBuilder, EpubVersion3, content::ContentBuilder};

        #[test]
        fn test_make_contents_basic() {
            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();
            builder.add_rootfile("content.opf").unwrap();

            let mut content_builder = ContentBuilder::new("chapter1", "en").unwrap();
            content_builder
                .set_title("Test Chapter")
                .add_text_block("This is a test paragraph.", vec![])
                .unwrap();

            builder.add_content("OEBPS/chapter1.xhtml", content_builder);

            assert!(builder.make_contents().is_ok());
            assert!(builder.temp_dir.join("OEBPS/chapter1.xhtml").exists());
        }

        #[test]
        fn test_make_contents_multiple_blocks() {
            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();
            builder.add_rootfile("content.opf").unwrap();

            let mut content_builder = ContentBuilder::new("chapter2", "zh-CN").unwrap();
            content_builder
                .set_title("多个区块章节")
                .add_text_block("第一段文本。", vec![])
                .unwrap()
                .add_quote_block("这是一个引用。", vec![])
                .unwrap()
                .add_title_block("子标题", 2, vec![])
                .unwrap()
                .add_text_block("最后的文本段落。", vec![])
                .unwrap();

            builder.add_content("OEBPS/chapter2.xhtml", content_builder);

            assert!(builder.make_contents().is_ok());
            assert!(builder.temp_dir.join("OEBPS/chapter2.xhtml").exists());
        }

        #[test]
        fn test_make_contents_with_media() {
            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();
            builder.add_rootfile("content.opf").unwrap();

            let mut content_builder = ContentBuilder::new("chapter3", "en").unwrap();
            content_builder
                .set_title("Chapter with Media")
                .add_text_block("Text before image.", vec![])
                .unwrap()
                .add_image_block(
                    std::path::PathBuf::from("./test_case/image.jpg"),
                    Some("Test Image".to_string()),
                    Some("Figure 1: A test image".to_string()),
                    vec![],
                )
                .unwrap()
                .add_text_block("Text after image.", vec![])
                .unwrap();

            builder.add_content("OEBPS/chapter3.xhtml", content_builder);

            assert!(builder.make_contents().is_ok());
            assert!(builder.temp_dir.join("OEBPS/chapter3.xhtml").exists());
            assert!(builder.temp_dir.join("OEBPS/img/image.jpg").exists());
        }

        #[test]
        fn test_make_contents_multiple_documents() {
            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();
            builder.add_rootfile("content.opf").unwrap();

            for (id, title) in [
                ("ch1", "Chapter 1"),
                ("ch2", "Chapter 2"),
                ("ch3", "Chapter 3"),
            ] {
                let mut content = ContentBuilder::new(id, "en").unwrap();
                content
                    .set_title(title)
                    .add_text_block(&format!("Content of {}", title), vec![])
                    .unwrap();
                builder.add_content(format!("OEBPS/{}.xhtml", id), content);
            }

            assert!(builder.make_contents().is_ok());
            assert!(builder.temp_dir.join("OEBPS/ch1.xhtml").exists());
            assert!(builder.temp_dir.join("OEBPS/ch2.xhtml").exists());
            assert!(builder.temp_dir.join("OEBPS/ch3.xhtml").exists());
        }

        #[test]
        fn test_make_contents_different_languages() {
            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();
            builder.add_rootfile("content.opf").unwrap();

            let langs = [
                ("en_ch", "en", "English Chapter"),
                ("zh_ch", "zh-CN", "中文章节"),
                ("ja_ch", "ja", "日本語の章"),
            ];

            for (id, lang, title) in langs {
                let mut content = ContentBuilder::new(id, lang).unwrap();
                content
                    .set_title(title)
                    .add_text_block(&format!("Text in {}", lang), vec![])
                    .unwrap();
                builder.add_content(format!("OEBPS/{}_chapter.xhtml", id), content);
            }

            assert!(builder.make_contents().is_ok());
            assert!(builder.temp_dir.join("OEBPS/en_ch_chapter.xhtml").exists());
            assert!(builder.temp_dir.join("OEBPS/zh_ch_chapter.xhtml").exists());
            assert!(builder.temp_dir.join("OEBPS/ja_ch_chapter.xhtml").exists());
        }

        #[test]
        fn test_make_contents_unique_identifiers() {
            use std::path::PathBuf;

            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();
            builder.add_rootfile("content.opf").unwrap();

            let mut content1 = ContentBuilder::new("unique_id_1", "en").unwrap();
            content1.add_text_block("First content", vec![]).unwrap();
            builder.add_content("OEBPS/ch1.xhtml", content1);

            let mut content2 = ContentBuilder::new("unique_id_2", "en").unwrap();
            content2.add_text_block("Second content", vec![]).unwrap();
            builder.add_content("OEBPS/ch2.xhtml", content2);

            let mut content3 = ContentBuilder::new("unique_id_1", "en").unwrap();
            content3
                .add_text_block("Duplicate ID content", vec![])
                .unwrap();
            builder.add_content("OEBPS/ch3.xhtml", content3);

            assert!(builder.make_contents().is_ok());
            assert!(builder.temp_dir.join("OEBPS/ch1.xhtml").exists());
            assert!(builder.temp_dir.join("OEBPS/ch2.xhtml").exists());
            assert!(builder.temp_dir.join("OEBPS/ch3.xhtml").exists());

            let manifest = builder.manifest.manifest.get("unique_id_1").unwrap();
            assert_eq!(manifest.path, PathBuf::from("/OEBPS/ch3.xhtml"));
        }

        #[test]
        fn test_make_contents_complex_structure() {
            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();
            builder.add_rootfile("content.opf").unwrap();

            let mut content = ContentBuilder::new("complex_ch", "en").unwrap();
            content
                .set_title("Complex Chapter")
                .add_title_block("Section 1", 2, vec![])
                .unwrap()
                .add_text_block("Introduction text.", vec![])
                .unwrap()
                .add_quote_block("A wise quote here.", vec![])
                .unwrap()
                .add_title_block("Section 2", 2, vec![])
                .unwrap()
                .add_text_block("More content with multiple paragraphs.", vec![])
                .unwrap()
                .add_text_block("Another paragraph.", vec![])
                .unwrap()
                .add_title_block("Section 3", 2, vec![])
                .unwrap()
                .add_quote_block("Another quotation.", vec![])
                .unwrap();

            builder.add_content("OEBPS/complex_chapter.xhtml", content);

            assert!(builder.make_contents().is_ok());
            assert!(
                builder
                    .temp_dir
                    .join("OEBPS/complex_chapter.xhtml")
                    .exists()
            );
        }

        #[test]
        fn test_make_contents_empty_document() {
            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();
            builder.add_rootfile("content.opf").unwrap();

            let content = ContentBuilder::new("empty_ch", "en").unwrap();
            builder.add_content("OEBPS/empty.xhtml", content);

            assert!(builder.make_contents().is_ok());
            assert!(builder.temp_dir.join("OEBPS/empty.xhtml").exists());
        }

        #[test]
        fn test_make_contents_path_normalization() {
            let mut builder = EpubBuilder::<EpubVersion3>::new().unwrap();
            builder.add_rootfile("OEBPS/content.opf").unwrap();

            let mut content = ContentBuilder::new("path_test", "en").unwrap();
            content.add_text_block("Path test content", vec![]).unwrap();

            builder.add_content("/OEBPS/text/chapter.xhtml", content);

            assert!(builder.make_contents().is_ok());
            assert!(builder.temp_dir.join("OEBPS/text/chapter.xhtml").exists());
        }
    }
}
