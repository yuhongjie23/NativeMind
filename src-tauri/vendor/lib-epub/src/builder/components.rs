#[cfg(feature = "no-indexmap")]
use std::collections::HashMap;
#[cfg(feature = "content-builder")]
use std::io::Read;
use std::{
    fs,
    path::{Path, PathBuf},
};

use chrono::{SecondsFormat, Utc};
#[cfg(not(feature = "no-indexmap"))]
use indexmap::IndexMap;
use infer::Infer;
use quick_xml::events::{BytesDecl, BytesEnd, BytesStart, BytesText, Event};

#[cfg(feature = "content-builder")]
use crate::builder::content::ContentBuilder;
use crate::{
    builder::{XmlWriter, normalize_manifest_path, refine_mime_type},
    error::{EpubBuilderError, EpubError},
    types::{ManifestItem, MetadataItem, MetadataSheet, NavPoint, SpineItem},
    utils::ELEMENT_IN_DC_NAMESPACE,
};

/// Rootfile builder for EPUB container
///
/// The `RootfileBuilder` is responsible for managing the rootfile paths in the EPUB container.
/// Each rootfile points to an OPF (Open Packaging Format) file that defines the structure
/// and content of an EPUB publication.
///
/// In EPUB 3.0, a single rootfile is typically used, but the structure supports multiple
/// rootfiles for more complex publications.
///
/// ## Notes
///
/// - Rootfile paths must be relative and cannot start with "../" or "/"
/// - At least one rootfile must be added before building the EPUB
#[derive(Debug)]
pub struct RootfileBuilder {
    /// List of rootfile paths
    pub(crate) rootfiles: Vec<String>,
}

impl RootfileBuilder {
    /// Creates a new empty `RootfileBuilder` instance
    pub(crate) fn new() -> Self {
        Self { rootfiles: Vec::new() }
    }

    /// Add a rootfile path
    ///
    /// Adds a new rootfile path to the builder. The rootfile points to the OPF file
    /// that will be created when building the EPUB.
    ///
    /// ## Parameters
    /// - `rootfile`: The relative path to the OPF file
    ///
    /// ## Return
    /// - `Ok(&mut Self)`: Successfully added the rootfile
    /// - `Err(EpubError)`: Error if the path is invalid (starts with "/" or "../")
    pub fn add(&mut self, rootfile: impl AsRef<str>) -> Result<&mut Self, EpubError> {
        let rootfile = rootfile.as_ref();

        if rootfile.starts_with("/") || rootfile.starts_with("../") {
            return Err(EpubBuilderError::IllegalRootfilePath.into());
        }

        let rootfile = rootfile.strip_prefix("./").unwrap_or(rootfile);

        self.rootfiles.push(rootfile.into());
        Ok(self)
    }

    /// Clear all rootfiles
    ///
    /// Removes all rootfile paths from the builder.
    pub fn clear(&mut self) -> &mut Self {
        self.rootfiles.clear();
        self
    }

    /// Check if the builder is empty
    pub(crate) fn is_empty(&self) -> bool {
        self.rootfiles.is_empty()
    }

    /// Get the first rootfile
    pub(crate) fn first(&self) -> Option<&String> {
        self.rootfiles.first()
    }

    /// Generate the container.xml content
    ///
    /// Writes the XML representation of the container and rootfiles to the provided writer.
    pub(crate) fn make(&self, writer: &mut XmlWriter) -> Result<(), EpubError> {
        writer.write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))?;

        writer.write_event(Event::Start(BytesStart::new("container").with_attributes(
            [
                ("version", "1.0"),
                ("xmlns", "urn:oasis:names:tc:opendocument:xmlns:container"),
            ],
        )))?;
        writer.write_event(Event::Start(BytesStart::new("rootfiles")))?;

        for rootfile in &self.rootfiles {
            writer.write_event(Event::Empty(BytesStart::new("rootfile").with_attributes([
                ("full-path", rootfile.as_str()),
                ("media-type", "application/oebps-package+xml"),
            ])))?;
        }

        writer.write_event(Event::End(BytesEnd::new("rootfiles")))?;
        writer.write_event(Event::End(BytesEnd::new("container")))?;

        Ok(())
    }
}

/// Metadata builder for EPUB publications
///
/// The `MetadataBuilder` is responsible for managing metadata items in an EPUB publication.
/// Metadata includes essential information such as title, author, language, identifier,
/// publisher, and other descriptive information about the publication.
///
/// ## Required Metadata
///
/// According to the EPUB specification, the following metadata are required:
/// - `title`: The publication title
/// - `language`: The language of the publication (e.g., "en", "zh-CN")
/// - `identifier`: A unique identifier for the publication with id "pub-id"
#[derive(Debug)]
pub struct MetadataBuilder {
    /// List of metadata items
    pub(crate) metadata: Vec<MetadataItem>,
}

impl MetadataBuilder {
    /// Creates a new empty `MetadataBuilder` instance
    pub(crate) fn new() -> Self {
        Self { metadata: Vec::new() }
    }

    /// Add a metadata item
    ///
    /// Appends a new metadata item to the builder.
    ///
    /// ## Parameters
    /// - `item`: The metadata item to add
    ///
    /// ## Return
    /// - `&mut Self`: Returns a mutable reference to itself for method chaining
    pub fn add(&mut self, item: MetadataItem) -> &mut Self {
        self.metadata.push(item);
        self
    }

    /// Clear all metadata items
    ///
    /// Removes all metadata items from the builder.
    pub fn clear(&mut self) -> &mut Self {
        self.metadata.clear();
        self
    }

    /// Add metadata items from a MetadataSheet
    ///
    /// Extends the builder with metadata items from the provided `MetadataSheet`.
    pub fn from(&mut self, sheet: MetadataSheet) -> &mut Self {
        self.metadata.extend(Vec::<MetadataItem>::from(sheet));
        self
    }

    /// Generate the metadata XML content
    ///
    /// Writes the XML representation of the metadata to the provided writer.
    /// This includes all metadata items and their refinements, as well as
    /// automatically adding a `dcterms:modified` timestamp.
    pub(crate) fn make(&mut self, writer: &mut XmlWriter) -> Result<(), EpubError> {
        self.metadata.push(MetadataItem {
            id: None,
            property: "dcterms:modified".to_string(),
            value: Utc::now().to_rfc3339_opts(SecondsFormat::AutoSi, true),
            lang: None,
            refined: vec![],
        });

        writer.write_event(Event::Start(BytesStart::new("metadata")))?;

        for metadata in &self.metadata {
            let tag_name = if ELEMENT_IN_DC_NAMESPACE.contains(&metadata.property.as_str()) {
                format!("dc:{}", metadata.property)
            } else {
                "meta".to_string()
            };

            writer.write_event(Event::Start(
                BytesStart::new(tag_name.as_str()).with_attributes(metadata.attributes()),
            ))?;
            writer.write_event(Event::Text(BytesText::new(metadata.value.as_str())))?;
            writer.write_event(Event::End(BytesEnd::new(tag_name.as_str())))?;

            for refinement in &metadata.refined {
                writer.write_event(Event::Start(
                    BytesStart::new("meta").with_attributes(refinement.attributes()),
                ))?;
                writer.write_event(Event::Text(BytesText::new(refinement.value.as_str())))?;
                writer.write_event(Event::End(BytesEnd::new("meta")))?;
            }
        }

        writer.write_event(Event::End(BytesEnd::new("metadata")))?;

        Ok(())
    }

    /// Verify metadata integrity
    ///
    /// Check if the required metadata items are included: title, language, and identifier with pub-id.
    pub(crate) fn validate(&self) -> Result<(), EpubError> {
        let mut has_title = false;
        let mut has_language = false;
        let mut has_identifier = false;

        for item in &self.metadata {
            match item.property.as_str() {
                "title" => has_title = true,
                "language" => has_language = true,
                "identifier" => {
                    if item.id.as_ref().is_some_and(|id| id == "pub-id") {
                        has_identifier = true;
                    }
                }
                _ => {}
            }

            if has_title && has_language && has_identifier {
                return Ok(());
            }
        }

        Err(EpubBuilderError::MissingNecessaryMetadata.into())
    }
}

/// Manifest builder for EPUB resources
///
/// The `ManifestBuilder` is responsible for managing manifest items in an EPUB publication.
/// The manifest declares all resources (HTML files, images, stylesheets, fonts, etc.)
/// that are part of the EPUB publication.
///
/// Each manifest item must have a unique identifier and a path to the resource file.
/// The builder automatically determines the MIME type of each resource based on its content.
///
/// ## Resource Fallbacks
///
/// The manifest supports fallback chains for resources that may not be supported by all
/// reading systems. When adding a resource with a fallback, the builder validates that:
/// - The fallback chain does not contain circular references
/// - All referenced fallback resources exist in the manifest
///
/// ## Navigation Document
///
/// The manifest must contain exactly one item with the `nav` property, which serves
/// as the navigation document (table of contents) of the publication.
#[derive(Debug)]
pub struct ManifestBuilder {
    /// Temporary directory for storing files during build
    temp_dir: PathBuf,

    /// Rootfile path (OPF file location)
    rootfile: Option<String>,

    /// Manifest items stored in a map keyed by ID
    #[cfg(feature = "no-indexmap")]
    pub(crate) manifest: HashMap<String, ManifestItem>,
    #[cfg(not(feature = "no-indexmap"))]
    pub(crate) manifest: IndexMap<String, ManifestItem>,
}

impl ManifestBuilder {
    /// Creates a new `ManifestBuilder` instance
    ///
    /// ## Parameters
    /// - `temp_dir`: Temporary directory path for storing files during the build process
    pub(crate) fn new(temp_dir: impl AsRef<Path>) -> Self {
        Self {
            temp_dir: temp_dir.as_ref().to_path_buf(),
            rootfile: None,
            #[cfg(feature = "no-indexmap")]
            manifest: HashMap::new(),
            #[cfg(not(feature = "no-indexmap"))]
            manifest: IndexMap::new(),
        }
    }

    /// Set the rootfile path
    ///
    /// This must be called before adding manifest items.
    ///
    /// ## Parameters
    /// - `rootfile`: The rootfile path
    pub(crate) fn set_rootfile(&mut self, rootfile: impl Into<String>) {
        self.rootfile = Some(rootfile.into());
    }

    /// Add a manifest item and copy the resource file
    ///
    /// Adds a new resource to the manifest and copies the source file to the
    /// temporary directory. The builder automatically determines the MIME type
    /// based on the file content.
    ///
    /// ## Parameters
    /// - `manifest_source`: Path to the source file on the local filesystem
    /// - `manifest_item`: Manifest item with ID and target path
    ///
    /// ## Return
    /// - `Ok(&mut Self)`: Successfully added the resource
    /// - `Err(EpubError)`: Error if the source file doesn't exist or has an unknown format
    pub fn add(
        &mut self,
        manifest_source: impl Into<String>,
        manifest_item: ManifestItem,
    ) -> Result<&mut Self, EpubError> {
        // Check if the source path is a file
        let manifest_source = manifest_source.into();
        let source = PathBuf::from(&manifest_source);
        if !source.is_file() {
            return Err(EpubBuilderError::TargetIsNotFile { target_path: manifest_source }.into());
        }

        // Get the file extension
        let extension = match source.extension() {
            Some(ext) => ext.to_string_lossy().to_lowercase(),
            None => String::new(),
        };

        // Read the file
        let buf = fs::read(source)?;

        // Get the mime type
        let real_mime = match Infer::new().get(&buf) {
            Some(infer_mime) => refine_mime_type(infer_mime.mime_type(), &extension),
            None => {
                return Err(
                    EpubBuilderError::UnknownFileFormat { file_path: manifest_source }.into(),
                );
            }
        };

        let target_path = normalize_manifest_path(
            &self.temp_dir,
            self.rootfile
                .as_ref()
                .ok_or(EpubBuilderError::MissingRootfile)?,
            &manifest_item.path,
            &manifest_item.id,
        )?;
        if let Some(parent_dir) = target_path.parent() {
            if !parent_dir.exists() {
                fs::create_dir_all(parent_dir)?
            }
        }

        match fs::write(target_path, buf) {
            Ok(_) => {
                self.manifest
                    .insert(manifest_item.id.clone(), manifest_item.set_mime(real_mime));
                Ok(self)
            }
            Err(err) => Err(err.into()),
        }
    }

    /// Clear all manifest items
    ///
    /// Removes all manifest items from the builder and deletes the associated files
    /// from the temporary directory.
    pub fn clear(&mut self) -> &mut Self {
        let paths = self
            .manifest
            .values()
            .map(|manifest| &manifest.path)
            .collect::<Vec<&PathBuf>>();

        for path in paths {
            let _ = fs::remove_file(path);
        }

        self.manifest.clear();

        self
    }

    /// Insert a manifest item directly
    ///
    /// This method allows direct insertion of a manifest item without copying
    /// any files. Use this when the file already exists in the temporary directory.
    pub(crate) fn insert(
        &mut self,
        key: impl Into<String>,
        value: ManifestItem,
    ) -> Option<ManifestItem> {
        self.manifest.insert(key.into(), value)
    }

    /// Generate the manifest XML content
    ///
    /// Writes the XML representation of the manifest to the provided writer.
    pub(crate) fn make(&self, writer: &mut XmlWriter) -> Result<(), EpubError> {
        writer.write_event(Event::Start(BytesStart::new("manifest")))?;

        for manifest in self.manifest.values() {
            writer.write_event(Event::Empty(
                BytesStart::new("item").with_attributes(manifest.attributes()),
            ))?;
        }

        writer.write_event(Event::End(BytesEnd::new("manifest")))?;

        Ok(())
    }

    /// Validate manifest integrity
    ///
    /// Checks fallback chains for circular references and missing items,
    /// and verifies that exactly one nav item exists.
    pub(crate) fn validate(&self) -> Result<(), EpubError> {
        self.validate_fallback_chains()?;
        self.validate_nav()?;

        Ok(())
    }

    /// Get manifest item keys
    ///
    /// Returns an iterator over the keys (IDs) of all manifest items.
    ///
    /// ## Return
    /// - `impl Iterator<Item = &String>`: Iterator over manifest item keys
    pub(crate) fn keys(&self) -> impl Iterator<Item = &String> {
        self.manifest.keys()
    }

    // TODO: consider using BFS to validate fallback chains, to provide efficient
    /// Validate all fallback chains in the manifest
    ///
    /// Iterates through all manifest items and validates each fallback chain
    /// to ensure there are no circular references and all referenced items exist.
    fn validate_fallback_chains(&self) -> Result<(), EpubError> {
        for (id, item) in &self.manifest {
            if item.fallback.is_none() {
                continue;
            }

            let mut fallback_chain = Vec::new();
            self.validate_fallback_chain(id, &mut fallback_chain)?;
        }

        Ok(())
    }

    /// Recursively verify the validity of a single fallback chain
    ///
    /// This function recursively traces the fallback chain to check for the following issues:
    /// - Circular reference
    /// - The referenced fallback resource does not exist
    fn validate_fallback_chain(
        &self,
        manifest_id: &str,
        fallback_chain: &mut Vec<String>,
    ) -> Result<(), EpubError> {
        if fallback_chain.contains(&manifest_id.to_string()) {
            fallback_chain.push(manifest_id.to_string());

            return Err(EpubBuilderError::ManifestCircularReference {
                fallback_chain: fallback_chain.join("->"),
            }
            .into());
        }

        // Get the current item; its existence can be ensured based on the calling context.
        let item = self.manifest.get(manifest_id).unwrap();

        if let Some(fallback_id) = &item.fallback {
            if !self.manifest.contains_key(fallback_id) {
                return Err(EpubBuilderError::ManifestNotFound {
                    manifest_id: fallback_id.to_owned(),
                }
                .into());
            }

            fallback_chain.push(manifest_id.to_string());
            self.validate_fallback_chain(fallback_id, fallback_chain)
        } else {
            // The end of the fallback chain
            Ok(())
        }
    }

    /// Validate navigation list items
    ///
    /// Check if there is only one list item with the `nav` property.
    fn validate_nav(&self) -> Result<(), EpubError> {
        if self
            .manifest
            .values()
            .filter(|&item| {
                if let Some(properties) = &item.properties {
                    properties.split(" ").any(|property| property == "nav")
                } else {
                    false
                }
            })
            .count()
            == 1
        {
            Ok(())
        } else {
            Err(EpubBuilderError::TooManyNavFlags.into())
        }
    }
}

/// Spine builder for EPUB reading order
///
/// The `SpineBuilder` is responsible for managing the spine items in an EPUB publication.
/// The spine defines the default reading order of the publication - the sequence in which
/// the reading system should present the content documents to the reader.
///
/// Each spine item references a manifest item by its ID (idref), indicating which
/// resource should be displayed at that point in the reading order.
#[derive(Debug)]
pub struct SpineBuilder {
    /// List of spine items defining the reading order
    pub(crate) spine: Vec<SpineItem>,
}

impl SpineBuilder {
    /// Creates a new empty `SpineBuilder` instance
    pub(crate) fn new() -> Self {
        Self { spine: Vec::new() }
    }

    /// Add a spine item
    ///
    /// Appends a new spine item to the builder, defining the next position in
    /// the reading order.
    ///
    /// ## Parameters
    /// - `item`: The spine item to add
    ///
    /// ## Return
    /// - `&mut Self`: Returns a mutable reference to itself for method chaining
    pub fn add(&mut self, item: SpineItem) -> &mut Self {
        self.spine.push(item);
        self
    }

    /// Clear all spine items
    ///
    /// Removes all spine items from the builder.
    pub fn clear(&mut self) -> &mut Self {
        self.spine.clear();
        self
    }

    /// Generate the spine XML content
    ///
    /// Writes the XML representation of the spine to the provided writer.
    pub(crate) fn make(&self, writer: &mut XmlWriter) -> Result<(), EpubError> {
        writer.write_event(Event::Start(BytesStart::new("spine")))?;

        for spine in &self.spine {
            writer.write_event(Event::Empty(
                BytesStart::new("itemref").with_attributes(spine.attributes()),
            ))?;
        }

        writer.write_event(Event::End(BytesEnd::new("spine")))?;

        Ok(())
    }

    /// Validate spine references
    ///
    /// Checks that all spine item idref values exist in the manifest.
    ///
    /// ## Parameters
    /// - `manifest_keys`: Iterator over manifest item keys
    pub(crate) fn validate(
        &self,
        manifest_keys: impl Iterator<Item = impl AsRef<str>>,
    ) -> Result<(), EpubError> {
        let manifest_keys: Vec<String> = manifest_keys.map(|k| k.as_ref().to_string()).collect();
        for spine in &self.spine {
            if !manifest_keys.contains(&spine.idref) {
                return Err(
                    EpubBuilderError::SpineManifestNotFound { idref: spine.idref.clone() }.into(),
                );
            }
        }
        Ok(())
    }
}

/// Catalog builder for EPUB navigation
///
/// The `CatalogBuilder` is responsible for building the navigation document (TOC)
/// of an EPUB publication. The navigation document provides a hierarchical table
/// of contents that allows readers to navigate through the publication's content.
///
/// The navigation document is a special XHTML document that uses the EPUB Navigation
/// Document specification.
#[derive(Debug)]
pub struct CatalogBuilder {
    /// Title of the navigation document
    pub(crate) title: String,

    /// Navigation points (table of contents entries)
    pub(crate) catalog: Vec<NavPoint>,
}

impl CatalogBuilder {
    /// Creates a new empty `CatalogBuilder` instance
    pub(crate) fn new() -> Self {
        Self {
            title: String::new(),
            catalog: Vec::new(),
        }
    }

    /// Set the catalog title
    ///
    /// Sets the title that will be displayed at the top of the navigation document.
    ///
    /// ## Parameters
    /// - `title`: The title to set
    ///
    /// ## Return
    /// - `&mut Self`: Returns a mutable reference to itself for method chaining
    pub fn set_title(&mut self, title: impl Into<String>) -> &mut Self {
        self.title = title.into();
        self
    }

    /// Add a navigation point
    ///
    /// Appends a new navigation point to the catalog. Navigation points can be
    /// nested by using the `append_child` method on `NavPoint`.
    ///
    /// ## Parameters
    /// - `item`: The navigation point to add
    ///
    /// ## Return
    /// - `&mut Self`: Returns a mutable reference to itself for method chaining
    pub fn add(&mut self, item: NavPoint) -> &mut Self {
        self.catalog.push(item);
        self
    }

    /// Clear all catalog items
    ///
    /// Removes the title and all navigation points from the builder.
    pub fn clear(&mut self) -> &mut Self {
        self.title.clear();
        self.catalog.clear();
        self
    }

    /// Check if the catalog is empty
    ///
    /// ## Return
    /// - `true`: No navigation points have been added
    /// - `false`: At least one navigation point has been added
    pub(crate) fn is_empty(&self) -> bool {
        self.catalog.is_empty()
    }

    /// Generate the navigation document
    ///
    /// Creates the EPUB Navigation Document (NAV) as XHTML content with the
    /// specified title and navigation points.
    pub(crate) fn make(&self, writer: &mut XmlWriter) -> Result<(), EpubError> {
        writer.write_event(Event::Start(BytesStart::new("html").with_attributes([
            ("xmlns", "http://www.w3.org/1999/xhtml"),
            ("xmlns:epub", "http://www.idpf.org/2007/ops"),
        ])))?;

        // make head
        writer.write_event(Event::Start(BytesStart::new("head")))?;
        writer.write_event(Event::Start(BytesStart::new("title")))?;
        writer.write_event(Event::Text(BytesText::new(&self.title)))?;
        writer.write_event(Event::End(BytesEnd::new("title")))?;
        writer.write_event(Event::End(BytesEnd::new("head")))?;

        // make body
        writer.write_event(Event::Start(BytesStart::new("body")))?;
        writer.write_event(Event::Start(
            BytesStart::new("nav").with_attributes([("epub:type", "toc")]),
        ))?;

        if !self.title.is_empty() {
            writer.write_event(Event::Start(BytesStart::new("h1")))?;
            writer.write_event(Event::Text(BytesText::new(&self.title)))?;
            writer.write_event(Event::End(BytesEnd::new("h1")))?;
        }

        Self::make_nav(writer, &self.catalog)?;

        writer.write_event(Event::End(BytesEnd::new("nav")))?;
        writer.write_event(Event::End(BytesEnd::new("body")))?;

        writer.write_event(Event::End(BytesEnd::new("html")))?;

        Ok(())
    }

    /// Generate navigation list items recursively
    ///
    /// Recursively writes the navigation list (ol/li elements) for the given
    /// navigation points.
    fn make_nav(writer: &mut XmlWriter, navgations: &Vec<NavPoint>) -> Result<(), EpubError> {
        writer.write_event(Event::Start(BytesStart::new("ol")))?;

        for nav in navgations {
            writer.write_event(Event::Start(BytesStart::new("li")))?;

            if let Some(path) = &nav.content {
                writer.write_event(Event::Start(
                    BytesStart::new("a").with_attributes([("href", path.to_string_lossy())]),
                ))?;
                writer.write_event(Event::Text(BytesText::new(nav.label.as_str())))?;
                writer.write_event(Event::End(BytesEnd::new("a")))?;
            } else {
                writer.write_event(Event::Start(BytesStart::new("span")))?;
                writer.write_event(Event::Text(BytesText::new(nav.label.as_str())))?;
                writer.write_event(Event::End(BytesEnd::new("span")))?;
            }

            if !nav.children.is_empty() {
                Self::make_nav(writer, &nav.children)?;
            }

            writer.write_event(Event::End(BytesEnd::new("li")))?;
        }

        writer.write_event(Event::End(BytesEnd::new("ol")))?;

        Ok(())
    }
}

#[cfg(feature = "content-builder")]
#[derive(Debug)]
pub struct DocumentBuilder {
    pub(crate) documents: Vec<(PathBuf, ContentBuilder)>,
}

#[cfg(feature = "content-builder")]
impl DocumentBuilder {
    /// Creates a new empty `DocumentBuilder` instance
    pub(crate) fn new() -> Self {
        Self { documents: Vec::new() }
    }

    /// Add a content document
    ///
    /// Appends a new content document to be processed during EPUB building.
    ///
    /// ## Parameters
    /// - `target`: The target path within the EPUB container where the content will be placed
    /// - `content`: The content builder containing the document content
    ///
    /// ## Return
    /// - `&mut Self`: Returns a mutable reference to itself for method chaining
    pub fn add(&mut self, target: impl AsRef<str>, content: ContentBuilder) -> &mut Self {
        self.documents
            .push((PathBuf::from(target.as_ref()), content));
        self
    }

    /// Clear all documents
    ///
    /// Removes all content documents from the builder.
    pub fn clear(&mut self) -> &mut Self {
        self.documents.clear();
        self
    }

    /// Generate manifest items from content documents
    ///
    /// Processes all content documents and generates the corresponding manifest items.
    /// Each content document may generate multiple manifest entries - one for the main
    /// document and additional entries for any resources (images, fonts, etc.) it contains.
    ///
    /// ## Parameters
    /// - `temp_dir`: The temporary directory path used during the EPUB build process
    /// - `rootfile`: The path to the OPF file (package document)
    ///
    /// ## Return
    /// - `Ok(Vec<ManifestItem>)`: List of manifest items generated from the content documents
    /// - `Err(EpubError)`: Error if document generation or file processing fails
    pub fn make(
        &mut self,
        temp_dir: PathBuf,
        rootfile: impl AsRef<str>,
    ) -> Result<Vec<ManifestItem>, EpubError> {
        let mut buf = vec![0; 512];
        let contents = std::mem::take(&mut self.documents);

        let mut manifest = Vec::new();
        for (target, mut content) in contents.into_iter() {
            let manifest_id = content.id.clone();

            // target is relative to the epub file, so we need to normalize it
            let absolute_target =
                normalize_manifest_path(&temp_dir, &rootfile, &target, &manifest_id)?;
            let mut resources = content.make(&absolute_target)?;

            // Helper to compute absolute container path
            let to_container_path = |p: &PathBuf| -> PathBuf {
                match p.strip_prefix(&temp_dir) {
                    Ok(rel) => PathBuf::from("/").join(rel.to_string_lossy().replace("\\", "/")),
                    Err(_) => unreachable!("path MUST under temp directory"),
                }
            };

            // Document (first element, guaranteed to exist)
            let path = resources.swap_remove(0);
            let mut file = std::fs::File::open(&path)?;
            let _ = file.read(&mut buf)?;
            let extension = path
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            let mime = match Infer::new().get(&buf) {
                Some(infer) => refine_mime_type(infer.mime_type(), &extension),
                None => {
                    return Err(EpubBuilderError::UnknownFileFormat {
                        file_path: path.to_string_lossy().to_string(),
                    }
                    .into());
                }
            }
            .to_string();

            manifest.push(ManifestItem {
                id: manifest_id.clone(),
                path: to_container_path(&path),
                mime,
                properties: None,
                fallback: None,
            });

            // Other resources (if any): generate stable ids and add to manifest
            for res in resources {
                let mut file = fs::File::open(&res)?;
                let _ = file.read(&mut buf)?;
                let extension = res
                    .extension()
                    .map(|e| e.to_string_lossy().to_lowercase())
                    .unwrap_or_default();
                let mime = match Infer::new().get(&buf) {
                    Some(ft) => refine_mime_type(ft.mime_type(), &extension),
                    None => {
                        return Err(EpubBuilderError::UnknownFileFormat {
                            file_path: path.to_string_lossy().to_string(),
                        }
                        .into());
                    }
                }
                .to_string();

                let file_name = res
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                let res_id = format!("{}-{}", manifest_id, file_name);

                manifest.push(ManifestItem {
                    id: res_id,
                    path: to_container_path(&res),
                    mime,
                    properties: None,
                    fallback: None,
                });
            }
        }

        Ok(manifest)
    }
}
