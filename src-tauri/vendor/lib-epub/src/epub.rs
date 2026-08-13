//! The core module of the EPUB parsing library
//!
//! This module provides complete parsing functionality for EPUB ebook files
//! and is the core component of the entire library. The `EpubDoc` structure
//! encapsulates all the parsing logic and data access interfaces for EPUB files.
//!
//! ## Main references to EPUB specs:
//! - <https://www.w3.org/TR/epub-33>
//! - <https://idpf.org/epub/201>
//!
//! ## Potential Issues
//! - The generic parameter `R: Read + Seek` increases complexity, particularly
//!   in asynchronous environments. The current design is not conducive to multi-threaded
//!   concurrent access and requires an external synchronization mechanism.
//! - Some error handling may not be sufficiently nuanced, and certain edge cases
//!   may not be adequately considered.
//! - Loading the entire EPUB document at once may result in significant memory consumption,
//!   especially for large publications.
//!
//! ## Future Work
//! - Supports more EPUB specification features, such as media overlay and scripts.

use std::{
    collections::HashMap,
    fs::{self, File},
    io::{BufReader, Read, Seek},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicUsize, Ordering},
    },
};

#[cfg(not(feature = "no-indexmap"))]
use indexmap::IndexMap;
use zip::{ZipArchive, result::ZipError};

use crate::{
    error::EpubError,
    types::{
        EncryptionData, EpubVersion, ManifestItem, MetadataItem, MetadataLinkItem,
        MetadataRefinement, MetadataSheet, NavPoint, SpineItem,
    },
    utils::{
        DecodeBytes, NormalizeWhitespace, XmlElement, XmlReader, adobe_font_dencryption,
        check_realtive_link_leakage, compression_method_check, get_file_in_zip_archive,
        idpf_font_dencryption,
    },
};

/// EPUB document parser, representing a loaded and parsed EPUB publication
///
/// The `EpubDoc` structure is the core of the entire EPUB parsing library.
/// It encapsulates all the parsing logic and data access interfaces for EPUB files.
/// It is responsible for parsing various components of an EPUB, including metadata,
/// manifests, reading order, table of contents navigation, and encrypted information,
/// and provides methods for accessing this data.
///
/// Provides a unified data access interface for EPUB files, hiding the underlying
/// file structure and parsing details. Strictly adheres to the EPUB specification
/// in implementing the parsing logic to ensure compatibility with the standard.
///
/// ## Usage
///
/// ```rust
/// use lib_epub::epub::EpubDoc;
///
/// let doc = EpubDoc::new("./test_case/epub-33.epub");
/// assert!(doc.is_ok());
/// ```
///
/// ## Notes
/// - The `EpubDoc` structure is thread-safe.
/// - The `EpubDoc` structure is immutable, modifying fields in a struct
///   will not modify the actual document.
pub struct EpubDoc<R: Read + Seek + Send> {
    /// The structure of the epub file that actually holds it
    pub(crate) archive: Arc<Mutex<ZipArchive<R>>>,

    /// The path to the target epub file
    pub(crate) epub_path: PathBuf,

    /// The path to the OPF file
    pub package_path: PathBuf,

    /// The path to the directory where the opf file is located
    pub base_path: PathBuf,

    /// The epub version
    pub version: EpubVersion,

    /// The unique identifier of the epub file
    ///
    /// This identifier is the actual value of the unique-identifier attribute of the package.
    pub unique_identifier: String,

    /// Epub metadata extracted from OPF
    pub metadata: Vec<MetadataItem>,

    /// Data in metadata that points to external files
    pub metadata_link: Vec<MetadataLinkItem>,

    /// A list of resources contained inside an epub extracted from OPF
    ///
    /// All resources in the epub file are declared here, and undeclared resources
    /// should not be stored in the epub file and cannot be obtained from it.
    ///
    /// ## Storage Implementation
    ///
    /// By default, this field uses [`IndexMap`] to preserve the original declaration
    /// order from the OPF file, as recommended by the EPUB specification.
    ///
    /// To reduce dependencies, you can enable the `no-indexmap` feature to use
    /// [`HashMap`] instead. Note that this will not preserve the manifest order.
    ///
    /// ## EPUB Specification
    ///
    /// Per the <https://www.w3.org/TR/epub-33/#sec-manifest>:
    ///
    /// > The order of `item` elements within the manifest is significant for
    /// > fallback chain processing and should be preserved when processing
    /// > the publication.
    #[cfg(not(feature = "no-indexmap"))]
    pub manifest: IndexMap<String, ManifestItem>,
    #[cfg(feature = "no-indexmap")]
    pub manifest: HashMap<String, ManifestItem>,

    /// Physical reading order of publications extracted from OPF
    ///
    /// This attribute declares the order in which multiple files
    /// containing published content should be displayed.
    pub spine: Vec<SpineItem>,

    /// The encryption.xml extracted from the META-INF directory
    pub encryption: Option<Vec<EncryptionData>>,

    /// The navigation data of the epub file
    pub catalog: Vec<NavPoint>,

    /// The title of the catalog
    pub catalog_title: String,

    /// The index of the current reading spine
    current_spine_index: AtomicUsize,

    /// Whether the epub file contains encryption information
    has_encryption: bool,

    /// The metadata sheet cache
    metadata_sheet: OnceLock<MetadataSheet>,
}

impl<R: Read + Seek + Send> EpubDoc<R> {
    /// Creates a new EPUB document instance from a reader
    ///
    /// This function is responsible for the core logic of parsing EPUB files,
    /// including verifying the file format, parsing container information,
    /// loading the OPF package document, and extracting metadata, manifest,
    /// reading order, and other core information.
    ///
    /// ## Parameters
    /// - `reader`: The data source that implements the `Read` and `Seek` traits,
    ///   usually a file or memory buffer
    /// - `epub_path`: The path to the EPUB file, used for path resolution and validation
    ///
    /// ## Return
    /// - `Ok(EpubDoc<R>)`: The successfully parsed EPUB document object
    /// - `Err(EpubError)`: Errors encountered during parsing
    ///
    /// ## Notes
    /// - This function assumes the EPUB file structure is valid
    // TODO: 增加对必需的 metadata 的检查
    pub fn from_reader(reader: R, epub_path: PathBuf) -> Result<Self, EpubError> {
        // Parsing process
        // 1. Verify that the ZIP compression method conforms to the EPUB specification
        // 2. Parse `META-INF/container.xml` retrieves the location of the OPF file
        // 3. Parses the OPF file to obtain package documentation information
        // 4. Extracts version information
        // 5. Parses metadata, manifest, and spine
        // 6. Parses encrypted information and directory navigation
        // 7. Verifies and extracts the unique identifier

        let mut archive = ZipArchive::new(reader).map_err(EpubError::from)?;
        let epub_path = fs::canonicalize(epub_path)?;

        compression_method_check(&mut archive)?;

        let container =
            get_file_in_zip_archive(&mut archive, "META-INF/container.xml")?.decode()?;
        let package_path = Self::parse_container(container)?;
        let base_path = package_path
            .parent()
            .expect("the parent directory of the opf file must exist")
            .to_path_buf();

        let opf_file = get_file_in_zip_archive(
            &mut archive,
            package_path
                .to_str()
                .expect("package_path should be valid UTF-8"),
        )?
        .decode()?;
        let package = XmlReader::parse(&opf_file)?;

        let version = Self::determine_epub_version(&package)?;
        let has_encryption = archive
            .by_path(Path::new("META-INF/encryption.xml"))
            .is_ok();

        let mut doc = Self {
            archive: Arc::new(Mutex::new(archive)),
            epub_path,
            package_path,
            base_path,
            version,
            unique_identifier: String::new(),
            metadata: vec![],
            metadata_link: vec![],

            #[cfg(feature = "no-indexmap")]
            manifest: HashMap::new(),
            #[cfg(not(feature = "no-indexmap"))]
            manifest: IndexMap::new(),

            spine: vec![],
            encryption: None,
            catalog: vec![],
            catalog_title: String::new(),
            current_spine_index: AtomicUsize::new(0),
            has_encryption,
            metadata_sheet: OnceLock::new(),
        };

        let metadata_element = package.find_elements_by_name("metadata").next().unwrap();
        let manifest_element = package.find_elements_by_name("manifest").next().unwrap();
        let spine_element = package.find_elements_by_name("spine").next().unwrap();

        doc.parse_metadata(metadata_element)?;
        doc.parse_manifest(manifest_element)?;
        doc.parse_spine(spine_element)?;
        doc.parse_encryption()?;
        doc.parse_catalog()?;

        // 断言必有唯一标识符
        doc.unique_identifier = if let Some(uid) = package.get_attr("unique-identifier") {
            doc.metadata.iter().find(|item| {
                item.property == "identifier" && item.id.as_ref().is_some_and(|id| id == &uid)
            })
        } else {
            doc.metadata
                .iter()
                .find(|item| item.property == "identifier")
        }
        .map(|item| item.value.clone())
        .ok_or_else(|| EpubError::NonCanonicalFile { tag: "dc:identifier".to_string() })?;

        Ok(doc)
    }

    /// Parse the EPUB container file (META-INF/container.xml)
    ///
    /// This function parses the container information in the EPUB file 、
    /// to extract the path to the OPF package file. According to the EPUB
    /// specification, the `container.xml` file must exist in the `META-INF`
    /// directory and contain at least one `rootfile` element pointing to
    /// the main OPF file. When multiple `rootfile` elements exist, the first
    /// element pointing to the OPF file is used as the default.
    ///
    /// ## Parameters
    /// - `data`: The content string of the container.xml
    ///
    /// ## Return
    /// - `Ok(PathBuf)`: The path to the successfully parsed OPF file
    /// - `Err(EpubError)`: Errors encountered during parsing
    fn parse_container(data: String) -> Result<PathBuf, EpubError> {
        let root = XmlReader::parse(&data)?;
        let rootfile = root
            .find_elements_by_name("rootfile")
            .next()
            .ok_or_else(|| EpubError::NonCanonicalFile { tag: "rootfile".to_string() })?;

        let attr =
            rootfile
                .get_attr("full-path")
                .ok_or_else(|| EpubError::MissingRequiredAttribute {
                    tag: "rootfile".to_string(),
                    attribute: "full-path".to_string(),
                })?;

        Ok(PathBuf::from(attr))
    }

    /// Parse the EPUB metadata section
    ///
    /// This function is responsible for parsing the `<metadata>` elements
    /// in the OPF file to extract basic information about the publication.
    /// It handles metadata elements from different namespaces:
    /// - Elements in the Dublin Core namespace (`http://purl.org/dc/elements/1.1/`)
    /// - Elements in the OPF namespace (`http://www.idpf.org/2007/opf`)
    ///
    /// ## Parameters
    /// - `metadata_element`: A reference to the `<metadata>` element in the OPF file
    fn parse_metadata(&mut self, metadata_element: &XmlElement) -> Result<(), EpubError> {
        const DC_NAMESPACE: &str = "http://purl.org/dc/elements/1.1/";
        const OPF_NAMESPACE: &str = "http://www.idpf.org/2007/opf";

        let mut metadata = Vec::new();
        let mut metadata_link = Vec::new();
        let mut refinements = HashMap::<String, Vec<MetadataRefinement>>::new();

        for element in metadata_element.children() {
            match &element.namespace {
                Some(namespace) if namespace == DC_NAMESPACE => {
                    self.parse_dc_metadata(element, &mut metadata)?
                }

                Some(namespace) if namespace == OPF_NAMESPACE => self.parse_opf_metadata(
                    element,
                    &mut metadata,
                    &mut metadata_link,
                    &mut refinements,
                )?,

                _ => {}
            };
        }

        for item in metadata.iter_mut() {
            if let Some(id) = &item.id {
                if let Some(refinements) = refinements.remove(id) {
                    item.refined = refinements;
                }
            }
        }

        self.metadata = metadata;
        self.metadata_link = metadata_link;
        Ok(())
    }

    /// Parse the EPUB manifest section
    ///
    /// This function parses the `<manifest>` element in the OPF file, extracting
    /// information about all resource files in the publication. Each resource contains
    /// basic information such as id, file path, MIME type, as well as optional
    /// attributes and fallback resource information.
    ///
    /// ## Parameters
    /// - `manifest_element`: A reference to the `<manifest>` element in the OPF file
    fn parse_manifest(&mut self, manifest_element: &XmlElement) -> Result<(), EpubError> {
        let estimated_items = manifest_element.children().count();
        #[cfg(feature = "no-indexmap")]
        let mut resources = HashMap::with_capacity(estimated_items);
        #[cfg(not(feature = "no-indexmap"))]
        let mut resources = IndexMap::with_capacity(estimated_items);

        for element in manifest_element.children() {
            let id = element
                .get_attr("id")
                .ok_or_else(|| EpubError::MissingRequiredAttribute {
                    tag: element.tag_name(),
                    attribute: "id".to_string(),
                })?
                .to_string();
            let path = element
                .get_attr("href")
                .ok_or_else(|| EpubError::MissingRequiredAttribute {
                    tag: element.tag_name(),
                    attribute: "href".to_string(),
                })?
                .to_string();
            let mime = element
                .get_attr("media-type")
                .ok_or_else(|| EpubError::MissingRequiredAttribute {
                    tag: element.tag_name(),
                    attribute: "media-type".to_string(),
                })?
                .to_string();
            let properties = element.get_attr("properties");
            let fallback = element.get_attr("fallback");

            resources.insert(
                id.clone(),
                ManifestItem {
                    id,
                    path: self.normalize_manifest_path(&path)?,
                    mime,
                    properties,
                    fallback,
                },
            );
        }

        self.manifest = resources;
        self.validate_fallback_chains();
        Ok(())
    }

    /// Parse the EPUB spine section
    ///
    /// This function parses the `<spine>` elements in the OPF file to extract
    /// the reading order information of the publication. The spine defines the
    /// linear reading order of the publication's content documents, and each
    /// spine item references resources in the manifest.
    ///
    /// ## Parameters
    /// - `spine_element`: A reference to the `<spine>` element in the OPF file
    fn parse_spine(&mut self, spine_element: &XmlElement) -> Result<(), EpubError> {
        let mut spine = Vec::new();
        for element in spine_element.children() {
            let idref = element
                .get_attr("idref")
                .ok_or_else(|| EpubError::MissingRequiredAttribute {
                    tag: element.tag_name(),
                    attribute: "idref".to_string(),
                })?
                .to_string();
            let id = element.get_attr("id");
            let linear = element
                .get_attr("linear")
                .map(|linear| linear == "yes")
                .unwrap_or(true);
            let properties = element.get_attr("properties");

            spine.push(SpineItem { idref, id, linear, properties });
        }

        self.spine = spine;
        Ok(())
    }

    /// Parse the EPUB encryption file (META-INF/encryption.xml)
    ///
    /// This function is responsible for parsing the `encryption.xml` file
    /// in the `META-INF` directory to extract information about encrypted
    /// resources in the publication. According to the EPUB specification,
    /// the encryption information describes which resources are encrypted
    /// and the encryption methods used.
    ///
    /// TODO: 需要对使用非对称加密数据的加密项进行额外处理，以获取非对称加密密钥
    fn parse_encryption(&mut self) -> Result<(), EpubError> {
        if !self.has_encryption() {
            return Ok(());
        }

        let mut archive = self.archive.lock()?;
        let encryption_file =
            get_file_in_zip_archive(&mut archive, "META-INF/encryption.xml")?.decode()?;

        let root = XmlReader::parse(&encryption_file)?;

        let mut encryption_data = Vec::new();
        for data in root.children() {
            if data.name != "EncryptedData" {
                continue;
            }

            let method = data
                .find_elements_by_name("EncryptionMethod")
                .next()
                .ok_or_else(|| EpubError::NonCanonicalFile {
                    tag: "EncryptionMethod".to_string(),
                })?;
            let reference = data
                .find_elements_by_name("CipherReference")
                .next()
                .ok_or_else(|| EpubError::NonCanonicalFile {
                    tag: "CipherReference".to_string(),
                })?;

            encryption_data.push(EncryptionData {
                method: method
                    .get_attr("Algorithm")
                    .ok_or_else(|| EpubError::MissingRequiredAttribute {
                        tag: "EncryptionMethod".to_string(),
                        attribute: "Algorithm".to_string(),
                    })?
                    .to_string(),
                data: reference
                    .get_attr("URI")
                    .ok_or_else(|| EpubError::MissingRequiredAttribute {
                        tag: "CipherReference".to_string(),
                        attribute: "URI".to_string(),
                    })?
                    .to_string(),
            });
        }

        if !encryption_data.is_empty() {
            self.encryption = Some(encryption_data);
        }

        Ok(())
    }

    /// Parse the EPUB navigation information
    ///
    /// This function is responsible for parsing the navigation information of EPUB
    /// publications. Different parsing strategies are used depending on the EPUB version:
    /// - EPUB 2.0: Parses the NCX file to obtain directory information
    /// - EPUB 3.0: Parses the Navigation Document (NAV) file to obtain directory information
    fn parse_catalog(&mut self) -> Result<(), EpubError> {
        const HEAD_TAGS: [&str; 6] = ["h1", "h2", "h3", "h4", "h5", "h6"];

        let mut archive = self.archive.lock()?;
        match self.version {
            EpubVersion::Version2_0 => {
                let opf_file =
                    get_file_in_zip_archive(&mut archive, self.package_path.to_str().unwrap())?
                        .decode()?;
                let opf_element = XmlReader::parse(&opf_file)?;

                let toc_id = opf_element
                    .find_children_by_name("spine")
                    .next()
                    .ok_or_else(|| EpubError::NonCanonicalFile { tag: "spine".to_string() })?
                    .get_attr("toc")
                    .ok_or_else(|| EpubError::MissingRequiredAttribute {
                        tag: "spine".to_string(),
                        attribute: "toc".to_string(),
                    })?
                    .to_owned();
                let toc_path = self
                    .manifest
                    .get(&toc_id)
                    .ok_or(EpubError::ResourceIdNotExist { id: toc_id })?
                    .path
                    .to_str()
                    .unwrap();

                let ncx_file = get_file_in_zip_archive(&mut archive, toc_path)?.decode()?;
                let ncx = XmlReader::parse(&ncx_file)?;

                match ncx.find_elements_by_name("docTitle").next() {
                    Some(element) => self.catalog_title = element.text(),
                    None => log::warn!(
                        "Expecting to get docTitle information from the ncx file, but it's missing."
                    ),
                };

                let nav_map = ncx
                    .find_elements_by_name("navMap")
                    .next()
                    .ok_or_else(|| EpubError::NonCanonicalFile { tag: "navMap".to_string() })?;

                self.catalog = self.parse_nav_points(nav_map)?;

                Ok(())
            }

            EpubVersion::Version3_0 => {
                let nav_path = self
                    .manifest
                    .values()
                    .find(|item| {
                        if let Some(property) = &item.properties {
                            return property.contains("nav");
                        }
                        false
                    })
                    .map(|item| item.path.clone())
                    .ok_or_else(|| EpubError::NonCanonicalEpub {
                        expected_file: "Navigation Document".to_string(),
                    })?;

                let nav_file =
                    get_file_in_zip_archive(&mut archive, nav_path.to_str().unwrap())?.decode()?;

                let nav_element = XmlReader::parse(&nav_file)?;
                let nav = nav_element
                    .find_elements_by_name("nav")
                    .find(|&element| element.get_attr("epub:type") == Some(String::from("toc")))
                    .ok_or_else(|| EpubError::NonCanonicalFile { tag: "nav".to_string() })?;
                let nav_title = nav.find_children_by_names(&HEAD_TAGS).next();
                let nav_list = nav
                    .find_children_by_name("ol")
                    .next()
                    .ok_or_else(|| EpubError::NonCanonicalFile { tag: "ol".to_string() })?;

                self.catalog = self.parse_catalog_list(nav_list)?;
                if let Some(nav_title) = nav_title {
                    self.catalog_title = nav_title.text();
                };
                Ok(())
            }
        }
    }

    /// Check if the EPUB file contains `encryption.xml`
    ///
    /// This function determines whether a publication contains encrypted resources
    /// by checking if a `META-INF/encryption.xml` file exists in the EPUB package.
    /// According to the EPUB specification, when resources in a publication are
    /// encrypted, the corresponding encryption information must be declared in
    /// the `META-INF/encryption.xml` file.
    ///
    /// ## Return
    /// - `true` if the publication contains encrypted resources
    /// - `false` if the publication does not contain encrypted resources
    ///
    /// ## Notes
    /// - This function only checks the existence of the encrypted file;
    ///   it does not verify the validity of the encrypted information.
    #[inline]
    pub fn has_encryption(&self) -> bool {
        self.has_encryption
    }

    /// Retrieves a list of metadata items
    ///
    /// This function retrieves all matching metadata items from the EPUB metadata
    /// based on the specified attribute name (key). Metadata items may come from
    /// the DC (Dublin Core) namespace or the OPF namespace and contain basic
    /// information about the publication, such as title, author, identifier, etc.
    ///
    /// ## Parameters
    /// - `key`: The name of the metadata attribute to retrieve
    ///
    /// ## Return
    /// - `Some(Vec<MetadataItem>)`: A vector containing all matching metadata items
    /// - `None`: If no matching metadata items are found
    pub fn get_metadata(&self, key: &str) -> Option<Vec<MetadataItem>> {
        let metadatas = self
            .metadata
            .iter()
            .filter(|item| item.property == key)
            .cloned()
            .collect::<Vec<MetadataItem>>();

        (!metadatas.is_empty()).then_some(metadatas)
    }

    /// Retrieves a list of values for specific metadata items
    ///
    /// This function retrieves the values ​​of all matching metadata items from
    /// the EPUB metadata based on the given property name (key).
    ///
    /// ## Parameters
    /// - `key`: The name of the metadata attribute to retrieve
    ///
    /// ## Return
    /// - `Some(Vec<String>)`: A vector containing all matching metadata item values
    /// - `None`: If no matching metadata items are found
    pub fn get_metadata_value(&self, key: &str) -> Option<Vec<String>> {
        let values = self
            .metadata
            .iter()
            .filter(|item| item.property == key)
            .map(|item| item.value.clone())
            .collect::<Vec<String>>();

        (!values.is_empty()).then_some(values)
    }

    /// Retrieves the title of the publication
    ///
    /// This function retrieves all title information from the EPUB metadata.
    /// According to the EPUB specification, a publication can have multiple titles,
    /// which are returned in the order they appear in the metadata.
    ///
    /// ## Return
    /// - `Result<Vec<String>, EpubError>`: A vector containing all title information
    /// - `EpubError`: If and only if the OPF file does not contain `<dc:title>`
    ///
    /// ## Notes
    /// - The EPUB specification requires each publication to have at least one title.
    #[inline]
    pub fn get_title(&self) -> Vec<String> {
        self.get_metadata_value("title")
            .expect("missing required 'title' metadata which is required by the EPUB specification")
    }

    /// Retrieves the language used in the publication
    ///
    /// This function retrieves the language information of a publication from the EPUB
    /// metadata. According to the EPUB specification, language information identifies
    /// the primary language of the publication and can have multiple language identifiers.
    ///
    /// ## Return
    /// - `Ok(Vec<String>)`: A vector containing all language identifiers
    /// - `Err(EpubError)`: If and only if the OPF file does not contain `<dc:language>`
    ///
    /// ## Notes
    /// - The EPUB specification requires that each publication specify at least one primary language.
    /// - Language identifiers should conform to RFC 3066 or later standards.
    #[inline]
    pub fn get_language(&self) -> Vec<String> {
        self.get_metadata_value("language").expect(
            "missing required 'language' metadata which is required by the EPUB specification",
        )
    }

    /// Retrieves the identifier of a publication
    ///
    /// This function retrieves the identifier information of a publication from
    /// the EPUB metadata. According to the EPUB specification, each publication
    /// must have a identifier, typically an ISBN, UUID, or other unique identifier.
    ///
    /// ## Return
    /// - `Ok(Vec<String>)`: A vector containing all identifier information
    /// - `Err(EpubError)`: If and only if the OPF file does not contain `<dc:identifier>`
    ///
    /// ## Notes
    /// - The EPUB specification requires each publication to have at least one identifier.
    /// - In the OPF file, the `unique-identifier` attribute of the `<package>` element
    ///   should point to a `<dc:identifier>` element used to uniquely identify the publication.
    ///   This means that `unique-identifier` is not exactly equal to `<dc:identifier>`.
    #[inline]
    pub fn get_identifier(&self) -> Vec<String> {
        self.get_metadata_value("identifier").expect(
            "missing required 'identifier' metadata which is required by the EPUB specification",
        )
    }

    /// Retrieves a unified metadata sheet from the EPUB publication
    ///
    /// This function consolidates all metadata from the EPUB into a single `MetadataSheet`
    /// structure, providing a simplified interface for metadata access. It handles both
    /// EPUB 2 and EPUB 3 metadata formats, including refinements from EPUB 3.
    ///
    /// ## Return
    /// - `MetadataSheet`: A populated metadata sheet containing all publication metadata
    ///
    /// ## Notes
    /// - Multi-value metadata (title, creator, etc.) are stored in Vec fields in order
    /// - Date metadata extracts event type from refinements (e.g., "publication", "modification")
    /// - Identifier metadata uses item IDs as keys in the HashMap
    pub fn get_metadata_sheet(&self) -> &MetadataSheet {
        self.metadata_sheet.get_or_init(|| {
            let mut sheet = MetadataSheet::new();
            for item in &self.metadata {
                let value = item.value.clone();

                match item.property.as_str() {
                    "title" => {
                        sheet.title.push(value);
                    }
                    "creator" => {
                        sheet.creator.push(value);
                    }
                    "contributor" => {
                        sheet.contributor.push(value);
                    }
                    "subject" => {
                        sheet.subject.push(value);
                    }
                    "language" => {
                        sheet.language.push(value);
                    }
                    "relation" => {
                        sheet.relation.push(value);
                    }
                    "date" => {
                        let event = item
                            .refined
                            .iter()
                            .filter_map(|refine| {
                                if refine.property.eq("event") {
                                    Some(refine.value.clone())
                                } else {
                                    None
                                }
                            })
                            .next()
                            .unwrap_or_default();
                        sheet.date.insert(value, event);
                    }
                    "identifier" => {
                        let id = item.id.clone().unwrap_or_default();
                        sheet.identifier.insert(id, value);
                    }
                    "description" => {
                        sheet.description = value;
                    }
                    "format" => {
                        sheet.format = value;
                    }
                    "publisher" => {
                        sheet.publisher = value;
                    }
                    "rights" => {
                        sheet.rights = value;
                    }
                    "source" => {
                        sheet.source = value;
                    }
                    "ccoverage" => {
                        sheet.coverage = value;
                    }
                    "type" => {
                        sheet.epub_type = value;
                    }
                    _ => {}
                };
            }
            sheet
        })
    }

    /// Retrieve resource data by resource ID
    ///
    /// This function will find the resource with the specified ID in the manifest.
    /// If the resource is encrypted, it will be automatically decrypted.
    ///
    /// ## Parameters
    /// - `id`: The ID of the resource to retrieve
    ///
    /// ## Return
    /// - `Ok((Vec<u8>, String))`: Successfully retrieved and decrypted resource data and
    ///   the MIME type
    /// - `Err(EpubError)`: Errors that occurred during the retrieval process
    ///
    /// ## Notes
    /// - This function will automatically decrypt the resource if it is encrypted.
    /// - For unsupported encryption methods, the corresponding error will be returned.
    pub fn get_manifest_item(&self, id: &str) -> Result<(Vec<u8>, String), EpubError> {
        let resource_item = self
            .manifest
            .get(id)
            .ok_or_else(|| EpubError::ResourceIdNotExist { id: id.to_string() })?;

        self.get_resource(resource_item)
    }

    /// Retrieves resource item data by resource path
    ///
    /// This function retrieves resources from the manifest based on the input path.
    /// The input path must be a relative path to the root directory of the EPUB container;
    /// using an absolute path or a relative path to another location will result in an error.
    ///
    /// ## Parameters
    /// - `path`: The path of the resource to retrieve
    ///
    /// ## Return
    /// - `Ok((Vec<u8>, String))`: Successfully retrieved and decrypted resource data and
    ///   the MIME type
    /// - `Err(EpubError)`: Errors that occurred during the retrieval process
    ///
    /// ## Notes
    /// - This function will automatically decrypt the resource if it is encrypted.
    /// - For unsupported encryption methods, the corresponding error will be returned.
    /// - Relative paths other than the root directory of the Epub container are not supported.
    pub fn get_manifest_item_by_path(&self, path: &str) -> Result<(Vec<u8>, String), EpubError> {
        let manifest = self
            .manifest
            .iter()
            .find(|(_, item)| item.path.to_str().unwrap() == path)
            .map(|(_, manifest)| manifest)
            .ok_or_else(|| EpubError::ResourceNotFound { resource: path.to_string() })?;

        self.get_resource(manifest)
    }

    /// Retrieves supported resource items by resource ID, with fallback mechanism supported
    ///
    /// This function attempts to retrieve the resource item with the specified ID and
    /// checks if its MIME type is in the list of supported formats. If the current resource
    /// format is not supported, it searches for a supported resource format along the
    /// fallback chain according to the fallback mechanism defined in the EPUB specification.
    ///
    /// ## Parameters
    /// - `id`: The ID of the resource to retrieve
    /// - `supported_format`: A vector of supported MIME types
    ///
    /// ## Return
    /// - `Ok((Vec<u8>, String))`: Successfully retrieved and decrypted resource data and
    ///   the MIME type
    /// - `Err(EpubError)`: Errors that occurred during the retrieval process
    pub fn get_manifest_item_with_fallback(
        &self,
        id: &str,
        supported_format: &[&str],
    ) -> Result<(Vec<u8>, String), EpubError> {
        let mut current_id = id;
        let mut fallback_chain = Vec::<&str>::new();
        'fallback: loop {
            let manifest_item = self
                .manifest
                .get(current_id)
                .ok_or_else(|| EpubError::ResourceIdNotExist { id: id.to_string() })?;

            if supported_format.contains(&manifest_item.mime.as_str()) {
                return self.get_resource(manifest_item);
            }

            let fallback_id = match &manifest_item.fallback {
                // The loop ends when no fallback resource exists
                None => break 'fallback,

                // End the loop when the loop continues to fallback if a fallback resource exists
                Some(id) if fallback_chain.contains(&id.as_str()) => break 'fallback,

                Some(id) => {
                    fallback_chain.push(id.as_str());

                    // Since only warnings are issued for fallback resource checks
                    // during initialization, the issue of fallback resources possibly
                    // not existing needs to be handled here.
                    id.as_str()
                }
            };

            current_id = fallback_id;
        }

        Err(EpubError::NoSupportedFileFormat)
    }

    /// Retrieves the cover of the EPUB document
    ///
    /// This function searches for the cover of the EPUB document by examining manifest
    /// items in the manifest. It looks for manifest items whose ID or attribute contains
    /// "cover" (case-insensitive) and attempts to retrieve the content of the first match.
    ///
    /// ## Return
    /// - `Some((Vec<u8>, String))`: Successfully retrieved and decrypted cover data and
    ///   the MIME type
    /// - `None`: No cover resource was found
    ///
    /// ## Notes
    /// - This function only returns the first successfully retrieved cover resource,
    ///   even if multiple matches exist
    /// - The retrieved cover may not be an image resource; users need to pay attention
    ///   to the resource's MIME type.
    pub fn get_cover(&self) -> Option<(Vec<u8>, String)> {
        self.manifest
            .values()
            .filter(|manifest| {
                manifest.id.to_ascii_lowercase().contains("cover")
                    || manifest
                        .properties
                        .as_ref()
                        .map(|properties| properties.to_ascii_lowercase().contains("cover"))
                        .unwrap_or(false)
            })
            .find_map(|manifest| {
                self.get_resource(manifest)
                    .map_err(|err| log::warn!("{err}"))
                    .ok()
            })
    }

    /// Retrieves resource data by manifest item
    fn get_resource(&self, resource_item: &ManifestItem) -> Result<(Vec<u8>, String), EpubError> {
        let path = resource_item
            .path
            .to_str()
            .expect("manifest item path should be valid UTF-8");

        let mut archive = self.archive.lock()?;
        let mut data = match archive.by_name(path) {
            Ok(mut file) => {
                let mut entry = Vec::<u8>::new();
                file.read_to_end(&mut entry)?;
                Ok(entry)
            }
            Err(ZipError::FileNotFound) => {
                Err(EpubError::ResourceNotFound { resource: path.to_string() })
            }
            Err(err) => Err(EpubError::from(err)),
        }?;

        if let Some(method) = self.is_encryption_file(path) {
            data = self.auto_dencrypt(&method, &mut data)?;
        }

        Ok((data, resource_item.mime.clone()))
    }

    /// Navigate to a specified chapter using the spine index
    ///
    /// This function retrieves the content data of the corresponding chapter based
    /// on the index position in the EPUB spine. The spine defines the linear reading
    /// order of the publication's content documents, and each spine item references
    /// resources in the manifest.
    ///
    /// ## Parameters
    /// - `index`: The index position in the spine, starting from 0
    ///
    /// ## Return
    /// - `Some((Vec<u8>, String))`: Successfully retrieved chapter content data and the MIME type
    /// - `None`: Index out of range or data retrieval error
    ///
    /// ## Notes
    /// - The index must be less than the total number of spine projects.
    /// - If the resource is encrypted, it will be automatically decrypted before returning.
    /// - It does not check whether the Spine project follows a linear reading order.
    pub fn navigate_by_spine_index(&self, index: usize) -> Option<(Vec<u8>, String)> {
        if index >= self.spine.len() {
            return None;
        }

        let manifest_id = self.spine[index].idref.as_ref();
        self.current_spine_index.store(index, Ordering::SeqCst);
        self.get_manifest_item(manifest_id)
            .map_err(|err| log::warn!("{err}"))
            .ok()
    }

    /// Navigate to the previous linear reading chapter
    ///
    /// This function searches backwards in the EPUB spine for the previous linear
    /// reading chapter and returns the content data of that chapter. It only navigates
    /// to chapters marked as linear reading.
    ///
    /// ## Return
    /// - `Some((Vec<u8>, String))`: Successfully retrieved previous chapter content data and
    ///   the MIME type
    /// - `None`: Already in the first chapter, the current chapter is not linear,
    ///   or data retrieval failed
    pub fn spine_prev(&self) -> Option<(Vec<u8>, String)> {
        let current_index = self.current_spine_index.load(Ordering::SeqCst);
        if current_index == 0 || !self.spine[current_index].linear {
            return None;
        }

        let prev_index = (0..current_index)
            .rev()
            .find(|&index| self.spine[index].linear)?;

        self.current_spine_index.store(prev_index, Ordering::SeqCst);
        let manifest_id = self.spine[prev_index].idref.as_ref();
        self.get_manifest_item(manifest_id)
            .map_err(|err| log::warn!("{err}"))
            .ok()
    }

    /// Navigate to the next linear reading chapter
    ///
    /// This function searches forwards in the EPUB spine for the next linear reading
    /// chapter and returns the content data of that chapter. It only navigates to
    /// chapters marked as linear reading.
    ///
    /// ## Return
    /// - `Some((Vec<u8>, String))`: Successfully retrieved next chapter content data and
    ///   the MIME type
    /// - `None`: Already in the last chapter, the current chapter is not linear,
    ///   or data retrieval failed
    pub fn spine_next(&self) -> Option<(Vec<u8>, String)> {
        let current_index = self.current_spine_index.load(Ordering::SeqCst);
        if current_index >= self.spine.len() - 1 || !self.spine[current_index].linear {
            return None;
        }

        let next_index =
            (current_index + 1..self.spine.len()).find(|&index| self.spine[index].linear)?;

        self.current_spine_index.store(next_index, Ordering::SeqCst);
        let manifest_id = self.spine[next_index].idref.as_ref();
        self.get_manifest_item(manifest_id)
            .map_err(|err| log::warn!("{err}"))
            .ok()
    }

    /// Retrieves the content data of the current chapter
    ///
    /// This function returns the content data of the chapter at the current
    /// index position in the EPUB spine.
    ///
    /// ## Return
    /// - `Some((Vec<u8>, String))`: Successfully retrieved current chapter content data and
    ///   the MIME type
    /// - `None`: Data retrieval failed
    pub fn spine_current(&self) -> Option<(Vec<u8>, String)> {
        let manifest_id = self.spine[self.current_spine_index.load(Ordering::SeqCst)]
            .idref
            .as_ref();
        self.get_manifest_item(manifest_id)
            .map_err(|err| log::warn!("{err}"))
            .ok()
    }

    /// Determine the EPUB version from the OPF file
    ///
    /// This function is used to detect the version of an epub file from an OPF file.
    /// When the version attribute in the package is abnormal, version information will
    /// be identified through some version characteristics of the epub file. An error is
    /// returned when neither direct nor indirect methods can identify the version.
    ///
    /// ## Parameters
    /// - `opf_element`: A reference to the OPF file element
    fn determine_epub_version(opf_element: &XmlElement) -> Result<EpubVersion, EpubError> {
        // Check the explicit version attribute
        if let Some(version) = opf_element.get_attr("version") {
            match version.as_str() {
                "2.0" => return Ok(EpubVersion::Version2_0),
                "3.0" => return Ok(EpubVersion::Version3_0),
                _ => {}
            }
        }

        let spine_element = opf_element
            .find_elements_by_name("spine")
            .next()
            .ok_or_else(|| EpubError::NonCanonicalFile { tag: "spine".to_string() })?;

        // Look for EPUB 2.x specific features
        if spine_element.get_attr("toc").is_some() {
            return Ok(EpubVersion::Version2_0);
        }

        let manifest_element = opf_element
            .find_elements_by_name("manifest")
            .next()
            .ok_or_else(|| EpubError::NonCanonicalFile { tag: "manifest".to_string() })?;

        // Look for EPUB 3.x specific features
        manifest_element
            .children()
            .find_map(|element| {
                if let Some(id) = element.get_attr("id") {
                    if id.eq("nav") {
                        return Some(EpubVersion::Version3_0);
                    }
                }

                None
            })
            .ok_or(EpubError::UnrecognizedEpubVersion)
    }

    /// Parse metadata elements under the Dublin Core namespace
    ///
    /// This function handles the `<metadata>` Dublin Core element in the OPF file (namespace
    /// is "http://purl.org/dc/elements/1.1/"). These elements usually contain the basic
    /// information of the publication, such as title, author, publication date, etc.
    ///
    /// ## Notes
    /// - In EPUB 3.0, granular information is handled by separate '<meta>' elements and 'refines' attributes
    /// - All text content is normalized by whitespace
    #[inline]
    fn parse_dc_metadata(
        &self,
        element: &XmlElement,
        metadata: &mut Vec<MetadataItem>,
        // refinements: &mut HashMap<String, Vec<MetadataRefinement>>,
    ) -> Result<(), EpubError> {
        let id = element.get_attr("id");
        let lang = element.get_attr("lang");
        let property = element.name.clone();
        let value = element.text().normalize_whitespace();

        let refined = match self.version {
            // In EPUB 2.0, supplementary metadata (refinements) are represented
            // through other attribute data pairs of the tag.
            EpubVersion::Version2_0 => element
                .attributes
                .iter()
                .map(|(name, value)| {
                    let property = name.to_string();
                    let value = value.to_string().normalize_whitespace();

                    MetadataRefinement {
                        // Patch (NativeMind): 上游 0.3.1 对「EPUB 2.0 中缺 id 属性的
                        // <meta> 标签」直接 unwrap panic（epub.rs:1154）。这是常见的不规范
                        // 文件（Z-Library 等工具导出），缺 id 时用空串代替，不 panic。
                        refines: id.clone().unwrap_or_default(),
                        property,
                        value,
                        lang: None,
                        scheme: None,
                    }
                })
                .collect(),
            EpubVersion::Version3_0 => vec![],
        };

        metadata.push(MetadataItem { id, property, value, lang, refined });

        Ok(())
    }

    /// Parse metadata elements under the OPF namespace
    ///
    /// This function handles the `<metadata>` OPF element in the OPF file (namespace
    /// is "http://www.idpf.org/2007/opf"). These elements include '<meta>' and '<link>',
    /// which are used to provide extended metadata and links to external resources for EPUB publications.
    ///
    /// ## Notes
    /// - The function is only responsible for distribution processing, and the
    ///   specific parsing logic is implemented in the dedicated function
    /// - All parsing results are added directly to the incoming collection and no new collection is returned
    #[inline]
    fn parse_opf_metadata(
        &self,
        element: &XmlElement,
        metadata: &mut Vec<MetadataItem>,
        metadata_link: &mut Vec<MetadataLinkItem>,
        refinements: &mut HashMap<String, Vec<MetadataRefinement>>,
    ) -> Result<(), EpubError> {
        match element.name.as_str() {
            "meta" => self.parse_meta_element(element, metadata, refinements),
            "link" => self.parse_link_element(element, metadata_link),
            _ => Ok(()),
        }
    }

    #[inline]
    fn parse_meta_element(
        &self,
        element: &XmlElement,
        metadata: &mut Vec<MetadataItem>,
        refinements: &mut HashMap<String, Vec<MetadataRefinement>>,
    ) -> Result<(), EpubError> {
        match self.version {
            EpubVersion::Version2_0 => {
                let property = element
                    .get_attr("name")
                    .ok_or_else(|| EpubError::NonCanonicalFile { tag: element.tag_name() })?;
                let value = element
                    .get_attr("content")
                    .ok_or_else(|| EpubError::MissingRequiredAttribute {
                        tag: element.tag_name(),
                        attribute: "content".to_string(),
                    })?
                    .normalize_whitespace();

                metadata.push(MetadataItem {
                    id: None,
                    property,
                    value,
                    lang: None,
                    refined: vec![],
                });
            }

            EpubVersion::Version3_0 => {
                let property = element.get_attr("property").ok_or_else(|| {
                    EpubError::MissingRequiredAttribute {
                        tag: element.tag_name(),
                        attribute: "property".to_string(),
                    }
                })?;
                let value = element.text().normalize_whitespace();
                let lang = element.get_attr("lang");

                if let Some(refines) = element.get_attr("refines") {
                    let id = refines.strip_prefix("#").unwrap_or(&refines).to_string();
                    let scheme = element.get_attr("scheme");
                    let refinement = MetadataRefinement {
                        refines: id.clone(),
                        property,
                        value,
                        lang,
                        scheme,
                    };

                    if let Some(refinements) = refinements.get_mut(&id) {
                        refinements.push(refinement);
                    } else {
                        refinements.insert(id, vec![refinement]);
                    }
                } else {
                    let id = element.get_attr("id");
                    let item = MetadataItem {
                        id,
                        property,
                        value,
                        lang,
                        refined: vec![],
                    };

                    metadata.push(item);
                };
            }
        }
        Ok(())
    }

    #[inline]
    fn parse_link_element(
        &self,
        element: &XmlElement,
        metadata_link: &mut Vec<MetadataLinkItem>,
    ) -> Result<(), EpubError> {
        let href = element
            .get_attr("href")
            .ok_or_else(|| EpubError::MissingRequiredAttribute {
                tag: element.tag_name(),
                attribute: "href".to_string(),
            })?;
        let rel = element
            .get_attr("rel")
            .ok_or_else(|| EpubError::MissingRequiredAttribute {
                tag: element.tag_name(),
                attribute: "rel".to_string(),
            })?;
        let hreflang = element.get_attr("hreflang");
        let id = element.get_attr("id");
        let mime = element.get_attr("media-type");
        let properties = element.get_attr("properties");

        metadata_link.push(MetadataLinkItem {
            href,
            rel,
            hreflang,
            id,
            mime,
            properties,
            refines: None,
        });
        Ok(())
    }

    /// Recursively parse NCX navigation points from navMap or nested navPoint elements
    ///
    /// This function parses the hierarchical navigation structure defined in NCX files
    /// for EPUB 2.x documents. It handles nested navPoint elements to build a complete
    /// tree representation of the publication's table of contents.
    fn parse_nav_points(&self, parent_element: &XmlElement) -> Result<Vec<NavPoint>, EpubError> {
        let mut nav_points = Vec::new();
        for nav_point in parent_element.find_children_by_name("navPoint") {
            let label = match nav_point.find_children_by_name("navLabel").next() {
                Some(element) => element.text(),
                None => String::new(),
            };

            let content = nav_point
                .find_children_by_name("content")
                .next()
                .map(|element| PathBuf::from(element.text()));

            let play_order = nav_point
                .get_attr("playOrder")
                .and_then(|order| order.parse::<usize>().ok());

            let children = self.parse_nav_points(nav_point)?;

            nav_points.push(NavPoint { label, content, play_order, children });
        }

        nav_points.sort();
        Ok(nav_points)
    }

    /// Recursively parses directory list structures
    ///
    /// This function recursively parses HTML navigation list structures,
    /// converting `<ol>` and `<li>` elements into NavPoint structures.
    /// Multi-level nested directory structures are supported.
    fn parse_catalog_list(&self, element: &XmlElement) -> Result<Vec<NavPoint>, EpubError> {
        let mut catalog = Vec::new();
        for item in element.children() {
            if item.tag_name() != "li" {
                return Err(EpubError::NonCanonicalFile { tag: "li".to_string() });
            }

            let title_element = item
                .find_children_by_names(&["span", "a"])
                .next()
                .ok_or_else(|| EpubError::NonCanonicalFile { tag: "span/a".to_string() })?;
            let content_href = title_element.get_attr("href").map(PathBuf::from);
            let sub_list = if let Some(list) = item.find_children_by_name("ol").next() {
                self.parse_catalog_list(list)?
            } else {
                vec![]
            };

            catalog.push(NavPoint {
                label: title_element.text(),
                content: content_href,
                children: sub_list,
                play_order: None,
            });
        }

        Ok(catalog)
    }

    /// Converts relative paths in the manifest to normalized paths
    /// relative to the EPUB root directory
    ///
    /// This function processes the href attribute of resources in the EPUB
    /// manifest and converts it to a normalized path representation.
    /// It handles three types of paths:
    /// - Relative paths starting with `../` (checks if they exceed the EPUB package scope)
    /// - Absolute paths starting with `/` (relative to the EPUB root directory)
    /// - Other relative paths (relative to the directory containing the OPF file)
    ///
    /// ## Parameters
    /// - `path`: The href attribute value of the resource in the manifest
    ///
    /// ## Return
    /// - `Ok(PathBuf)`: The parsed normalized path
    /// - `Err(EpubError)`: Relative link leakage
    #[inline]
    fn normalize_manifest_path(&self, path: &str) -> Result<PathBuf, EpubError> {
        let path = if path.starts_with("../") {
            let mut current_dir = self.epub_path.join(&self.package_path);
            current_dir.pop();

            check_realtive_link_leakage(self.epub_path.clone(), current_dir, path)
                .map(PathBuf::from)
                .ok_or_else(|| EpubError::RelativeLinkLeakage { path: path.to_string() })?
        } else if let Some(stripped) = path.strip_prefix("/") {
            PathBuf::from(stripped.to_string())
        } else {
            self.base_path.join(path)
        };

        #[cfg(windows)]
        let path = PathBuf::from(path.to_string_lossy().replace('\\', "/"));

        Ok(path)
    }

    /// Verify the fallback chain of all manifest items
    ///
    /// This function iterates through all manifest items with the fallback
    /// attribute and verifies the validity of their fallback chains, including checking:
    /// - Whether circular references exist
    /// - Whether the fallback resource exists in the manifest
    ///
    /// ## Notes
    /// If an invalid fallback chain is found, a warning log will be logged
    /// but the processing flow will not be interrupted.
    // TODO: consider using BFS to validate fallback chains, to provide efficient
    fn validate_fallback_chains(&self) {
        for (id, item) in &self.manifest {
            if item.fallback.is_none() {
                continue;
            }

            let mut fallback_chain = Vec::new();
            if let Err(msg) = self.validate_fallback_chain(id, &mut fallback_chain) {
                log::warn!("Invalid fallback chain for item {}: {}", id, msg);
            }
        }
    }

    /// Recursively verify the validity of a single fallback chain
    ///
    /// This function recursively traces the fallback chain to check for the following issues:
    /// - Circular reference
    /// - The referenced fallback resource does not exist
    ///
    /// ## Parameters
    /// - `manifest_id`: The id of the manifest item currently being verified
    /// - `fallback_chain`: The visited fallback chain paths used to detect circular references
    ///
    /// ## Return
    /// - `Ok(())`: The fallback chain is valid
    /// - `Err(String)`: A string containing error information
    fn validate_fallback_chain(
        &self,
        manifest_id: &str,
        fallback_chain: &mut Vec<String>,
    ) -> Result<(), String> {
        if fallback_chain.contains(&manifest_id.to_string()) {
            fallback_chain.push(manifest_id.to_string());

            return Err(format!(
                "Circular reference detected in fallback chain for {}",
                fallback_chain.join("->")
            ));
        }

        // Get the current item; its existence can be ensured based on the calling context.
        let item = self.manifest.get(manifest_id).unwrap();

        if let Some(fallback_id) = &item.fallback {
            if !self.manifest.contains_key(fallback_id) {
                return Err(format!(
                    "Fallback resource {} does not exist in manifest",
                    fallback_id
                ));
            }

            fallback_chain.push(manifest_id.to_string());
            self.validate_fallback_chain(fallback_id, fallback_chain)
        } else {
            // The end of the fallback chain
            Ok(())
        }
    }

    /// Checks if a resource at the specified path is an encrypted file
    ///
    /// This function queries whether a specific resource path is marked as an encrypted
    /// file in the EPUB encryption information. It checks the encrypted data stored in
    /// `self.encryption`, looking for an entry that matches the given path.
    ///
    /// ## Parameters
    /// - `path`: The path of the resource to check
    ///
    /// ## Return
    /// - `Some(String)`: The encryption method used for the resource
    /// - `None`: The resource is not encrypted
    fn is_encryption_file(&self, path: &str) -> Option<String> {
        self.encryption.as_ref().and_then(|encryptions| {
            encryptions
                .iter()
                .find(|encryption| encryption.data == path)
                .map(|encryption| encryption.method.clone())
        })
    }

    /// Automatically decrypts encrypted resource data
    ///
    /// Automatically decrypts data based on the provided encryption method.
    /// This function supports various encryption methods defined by the EPUB
    /// specification, including font obfuscation and the XML encryption standard.
    ///
    /// ## Parameters
    /// - `method`: The encryption method used for the resource
    /// - `data`: The encrypted resource data
    ///
    /// ## Return
    /// - `Ok(Vec<u8>)`: The decrypted resource data
    /// - `Err(EpubError)`: Unsupported encryption method
    ///
    /// ## Supported Encryption Methods
    /// - IDPF font obfuscation: `http://www.idpf.org/2008/embedding`
    /// - Adobe font obfuscation: `http://ns.adobe.com/pdf/enc#RC`
    #[inline]
    fn auto_dencrypt(&self, method: &str, data: &mut [u8]) -> Result<Vec<u8>, EpubError> {
        match method {
            "http://www.idpf.org/2008/embedding" => {
                Ok(idpf_font_dencryption(data, &self.unique_identifier))
            }
            "http://ns.adobe.com/pdf/enc#RC" => {
                Ok(adobe_font_dencryption(data, &self.unique_identifier))
            }
            _ => Err(EpubError::UnsupportedEncryptedMethod { method: method.to_string() }),
        }
    }
}

impl EpubDoc<BufReader<File>> {
    /// Creates a new EPUB document instance
    ///
    /// This function is a convenience constructor for `EpubDoc`,
    /// used to create an EPUB parser instance directly from a file path.
    ///
    /// ## Parameters
    /// - `path`: The path to the EPUB file
    ///
    /// ## Return
    /// - `Ok(EpubDoc)`: The created EPUB document instance
    /// - `Err(EpubError)`: An error occurred during initialization
    pub fn new<P: AsRef<Path>>(path: P) -> Result<Self, EpubError> {
        let file = File::open(&path).map_err(EpubError::from)?;
        let path = fs::canonicalize(path)?;

        Self::from_reader(BufReader::new(file), path)
    }

    /// Validates whether a file is a valid EPUB document
    ///
    /// This function attempts to open and parse the given file as an EPUB document.
    /// It performs basic validation to determine if the file conforms to the EPUB specification.
    ///
    /// ## Parameters
    /// - `path`: The path to the file to validate
    ///
    /// ## Returns
    /// - `Ok(true)`: The file is a valid EPUB document
    /// - `Ok(false)`: The file exists but is not a valid EPUB (e.g., missing required files,
    ///   invalid XML structure, unrecognized version)
    /// - `Err(EpubError)`: A critical error occurred (e.g., IO error, ZIP archive error,
    ///   encoding error, mutex poison)
    pub fn is_valid_epub<P: AsRef<Path>>(path: P) -> Result<bool, EpubError> {
        let result = EpubDoc::new(path);

        match result {
            Ok(_) => Ok(true),
            Err(err) if Self::is_outside_error(&err) => Err(err),
            Err(_) => Ok(false),
        }
    }

    /// Determines if an error is a "critical" external error that should be propagated
    ///
    /// ## Error Classification
    /// Outside errors (returned as `Err`):
    /// - ArchiveError: ZIP archive corruption or read errors
    /// - IOError: File system or read errors
    /// - MutexError: Thread synchronization errors
    /// - Utf8DecodeError: UTF-8 encoding errors
    /// - Utf16DecodeError: UTF-16 encoding errors
    /// - QuickXmlError: XML parser errors
    ///
    /// Irrelevant errors (returned as `Ok(false)`):
    /// - these errors could not have occurred in this situation.
    /// - EpubBuilderError
    /// - WalkDirError
    ///
    /// Content errors (returned as `Ok(false)`):
    /// - All other EpubError variants
    fn is_outside_error(err: &EpubError) -> bool {
        matches!(
            err,
            EpubError::ArchiveError { .. }
                | EpubError::IOError { .. }
                | EpubError::MutexError
                | EpubError::Utf8DecodeError { .. }
                | EpubError::Utf16DecodeError { .. }
                | EpubError::QuickXmlError { .. }
        )
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs::File,
        io::BufReader,
        path::{Path, PathBuf},
    };

    use crate::{epub::EpubDoc, error::EpubError, utils::XmlReader};

    /// Section 3.3 package documents
    mod package_documents_tests {
        use std::{path::Path, sync::atomic::Ordering};

        use crate::epub::{EpubDoc, EpubVersion};

        /// ID: pkg-collections-unknown
        ///
        /// The package document contains a collection with an unknown role. The reading system must open the EPUB successfully.
        #[test]
        fn test_pkg_collections_unknown() {
            let epub_file = Path::new("./test_case/pkg-collections-unknown.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());
        }

        /// ID: pkg-creator-order
        ///
        /// Several creators are listed in the package document. The reading system must not display them out of order (but it may display only the first).
        #[test]
        fn test_pkg_creator_order() {
            let epub_file = Path::new("./test_case/pkg-creator-order.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            let creators = doc.get_metadata_value("creator");
            assert!(creators.is_some());

            let creators = creators.unwrap();
            assert_eq!(creators.len(), 5);
            assert_eq!(
                creators,
                vec![
                    "Dave Cramer",
                    "Wendy Reid",
                    "Dan Lazin",
                    "Ivan Herman",
                    "Brady Duga",
                ]
            );
        }

        /// ID: pkg-manifest-unknown
        ///
        /// The package document contains a manifest item with unknown properties. The reading system must open the EPUB successfully.
        #[test]
        fn test_pkg_manifest_order() {
            let epub_file = Path::new("./test_case/pkg-manifest-unknown.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            assert_eq!(doc.manifest.len(), 2);
            assert!(doc.get_manifest_item("nav").is_ok());
            assert!(doc.get_manifest_item("content_001").is_ok());
            assert!(doc.get_manifest_item("content_002").is_err());
        }

        /// ID: pkg-meta-unknown
        ///
        /// The package document contains a meta tag with an unknown property. The reading system must open the EPUB successfully.
        #[test]
        fn test_pkg_meta_unknown() {
            let epub_file = Path::new("./test_case/pkg-meta-unknown.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            let value = doc.get_metadata_value("dcterms:isReferencedBy");
            assert!(value.is_some());
            let value = value.unwrap();
            assert_eq!(value.len(), 1);
            assert_eq!(
                value,
                vec!["https://www.w3.org/TR/epub-rs/#confreq-rs-pkg-meta-unknown"]
            );

            let value = doc.get_metadata_value("dcterms:modified");
            assert!(value.is_some());
            let value = value.unwrap();
            assert_eq!(value.len(), 1);
            assert_eq!(value, vec!["2021-01-11T00:00:00Z"]);

            let value = doc.get_metadata_value("dcterms:title");
            assert!(value.is_none());
        }

        /// ID: pkg-meta-whitespace
        ///
        /// The package document's title and creator contain leading and trailing spaces along with excess internal whitespace. The reading system must render only a single space in all cases.
        #[test]
        fn test_pkg_meta_white_space() {
            let epub_file = Path::new("./test_case/pkg-meta-whitespace.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            let value = doc.get_metadata_value("creator");
            assert!(value.is_some());
            let value = value.unwrap();
            assert_eq!(value.len(), 1);
            assert_eq!(value, vec!["Dave Cramer"]);

            let value = doc.get_metadata_value("description");
            assert!(value.is_some());
            let value = value.unwrap();
            assert_eq!(value.len(), 1);
            assert_eq!(
                value,
                vec![
                    "The package document's title and creator contain leading and trailing spaces along with excess internal whitespace. The reading system must render only a single space in all cases."
                ]
            );
        }

        /// ID: pkg-spine-duplicate-item-hyperlink
        ///
        /// The spine contains several references to the same content document. The reading system must move to the position of the first duplicate in the reading order when following a hyperlink.
        #[test]
        fn test_pkg_spine_duplicate_item_hyperlink() {
            let epub_file = Path::new("./test_case/pkg-spine-duplicate-item-hyperlink.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            assert_eq!(doc.spine.len(), 4);
            assert_eq!(
                doc.navigate_by_spine_index(0).unwrap(),
                doc.get_manifest_item("content_001").unwrap()
            );
            assert_eq!(
                doc.navigate_by_spine_index(1).unwrap(),
                doc.get_manifest_item("content_002").unwrap()
            );
            assert_eq!(
                doc.navigate_by_spine_index(2).unwrap(),
                doc.get_manifest_item("content_002").unwrap()
            );
            assert_eq!(
                doc.navigate_by_spine_index(3).unwrap(),
                doc.get_manifest_item("content_002").unwrap()
            );
        }

        /// ID: pkg-spine-duplicate-item-rendering
        ///
        /// The spine contains several references to the same content document. The reading system must not skip the duplicates when rendering the reading order.
        #[test]
        fn test_pkg_spine_duplicate_item_rendering() {
            let epub_file = Path::new("./test_case/pkg-spine-duplicate-item-rendering.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            assert_eq!(doc.spine.len(), 4);

            let result = doc.spine_prev();
            assert!(result.is_none());

            let result = doc.spine_next();
            assert!(result.is_some());

            doc.spine_next();
            doc.spine_next();
            let result = doc.spine_next();
            assert!(result.is_none());
        }

        /// ID: pkg-spine-nonlinear-activation
        ///
        /// An itemref in the spine is marked as non-linear. Although it (possibly) cannot be accessed through the table of contents, it can be reached from a link in the XHTML content.
        #[test]
        fn test_pkg_spine_nonlinear_activation() {
            let epub_file = Path::new("./test_case/pkg-spine-nonlinear-activation.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            assert!(doc.spine_prev().is_none());
            assert!(doc.spine_next().is_none());

            assert!(doc.navigate_by_spine_index(1).is_some());
            assert!(doc.spine_prev().is_none());
            assert!(doc.spine_next().is_none());
        }

        /// ID: pkg-spine-order
        ///
        /// Basic test of whether a reading system can display spine items in the correct order. The test fails if the reading system presents content in the order in which the file names sort, or if it presents files in manifest order rather than spine order.
        #[test]
        fn test_pkg_spine_order() {
            let epub_file = Path::new("./test_case/pkg-spine-order.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            assert_eq!(doc.spine.len(), 4);
            assert_eq!(
                doc.spine
                    .iter()
                    .map(|item| item.idref.clone())
                    .collect::<Vec<String>>(),
                vec![
                    "d-content_001",
                    "c-content_002",
                    "b-content_003",
                    "a-content_004",
                ]
            );
        }

        /// ID: pkg-spine-order-svg
        ///
        /// Basic test of whether a reading system can display SVG spine items in the correct order.
        #[test]
        fn test_spine_order_svg() {
            let epub_file = Path::new("./test_case/pkg-spine-order-svg.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            assert_eq!(doc.spine.len(), 4);

            loop {
                if let Some(spine) = doc.spine_next() {
                    let idref = doc.spine[doc.current_spine_index.load(Ordering::Relaxed)]
                        .idref
                        .clone();
                    let resource = doc.get_manifest_item(&idref);
                    assert!(resource.is_ok());

                    let resource = resource.unwrap();
                    assert_eq!(spine, resource);
                } else {
                    break;
                }
            }

            assert_eq!(doc.current_spine_index.load(Ordering::Relaxed), 3);
        }

        /// ID: pkg-spine-unknown
        ///
        /// The package document contains a spine item with unknown properties. The reading system must open the EPUB successfully.
        #[test]
        fn test_pkg_spine_unknown() {
            let epub_file = Path::new("./test_case/pkg-spine-unknown.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            assert_eq!(doc.spine.len(), 1);
            assert_eq!(doc.spine[0].idref, "content_001");
            assert_eq!(doc.spine[0].id, None);
            assert_eq!(doc.spine[0].linear, true);
            assert_eq!(doc.spine[0].properties, Some("untrustworthy".to_string()));
        }

        /// ID: pkg-title-order
        ///
        /// Several titles are listed in the package document. The reading system must use the first title (and whether to use other titles is not defined).
        #[test]
        fn test_pkg_title_order() {
            let epub_file = Path::new("./test_case/pkg-title-order.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            let title_list = doc.get_title();
            assert_eq!(title_list.len(), 6);
            assert_eq!(
                title_list,
                vec![
                    "pkg-title-order",
                    "This title must not display first",
                    "Also, this title must not display first",
                    "This title also must not display first",
                    "This title must also not display first",
                    "This title must not display first, also",
                ]
            );
        }

        /// ID: pkg-unique-id
        ///
        /// The package document's dc:identifier is identical across two publications. The reading system should display both publications independently.
        #[test]
        fn test_pkg_unique_id() {
            let epub_file = Path::new("./test_case/pkg-unique-id.epub");
            let doc_1 = EpubDoc::new(epub_file);
            assert!(doc_1.is_ok());

            let epub_file = Path::new("./test_case/pkg-unique-id_duplicate.epub");
            let doc_2 = EpubDoc::new(epub_file);
            assert!(doc_2.is_ok());

            let doc_1 = doc_1.unwrap();
            let doc_2 = doc_2.unwrap();

            assert_eq!(doc_1.get_identifier(), doc_2.get_identifier());
            assert_eq!(doc_1.unique_identifier, "pkg-unique-id");
            assert_eq!(doc_2.unique_identifier, "pkg-unique-id");
        }

        /// ID: pkg-version-backward
        ///
        /// “Reading Systems MUST attempt to process an EPUB Publication whose Package Document version attribute is less than "3.0"”. This is an EPUB with package version attribute set to "0", to see if a reading system will open it.
        #[test]
        fn test_pkg_version_backward() {
            let epub_file = Path::new("./test_case/pkg-version-backward.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            assert_eq!(doc.version, EpubVersion::Version3_0);
        }

        /// ID: pkg-linked-records
        ///
        /// Reading System must process and display the title and creator metadata from the package document. An ONIX 3.0 format linked metadata record exists, but contains neither title nor creator metadata.
        #[test]
        fn test_pkg_linked_records() {
            let epub_file = Path::new("./test_case/pkg-linked-records.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            assert_eq!(doc.metadata_link.len(), 3);

            let item = doc.metadata_link.iter().find(|&item| {
                if let Some(properties) = &item.properties {
                    properties.eq("onix")
                } else {
                    false
                }
            });
            assert!(item.is_some());
        }

        /// ID: pkg-manifest-unlisted-resource
        ///
        /// The XHTML content references an image that does not appear in the manifest. The image should not be shown.
        #[test]
        fn test_pkg_manifest_unlisted_resource() {
            let epub_file = Path::new("./test_case/pkg-manifest-unlisted-resource.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            assert!(
                doc.get_manifest_item_by_path("EPUB/content_001.xhtml")
                    .is_ok()
            );

            assert!(doc.get_manifest_item_by_path("EPUB/red.png").is_err());
            let err = doc.get_manifest_item_by_path("EPUB/red.png").unwrap_err();
            assert_eq!(
                err.to_string(),
                "Resource not found: Unable to find resource from \"EPUB/red.png\"."
            );
        }
    }

    /// Section 3.4 manifest fallbacks
    ///
    /// The tests under this module seem to favor the reading system rather than the EPUB format itself
    mod manifest_fallbacks_tests {
        use std::path::Path;

        use crate::epub::EpubDoc;

        /// ID: pub-foreign_bad-fallback
        ///
        /// This is a test of manifest fallbacks where both the spine item and the fallback are likely to be unsupported. The spine item is a DMG, with a fallback to a PSD file. Reading systems may raise an error on the ingenstion workflow.
        #[test]
        fn test_pub_foreign_bad_fallback() {
            let epub_file = Path::new("./test_case/pub-foreign_bad-fallback.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            assert!(doc.get_manifest_item("content_001").is_ok());
            assert!(doc.get_manifest_item("bar").is_ok());

            assert_eq!(
                doc.get_manifest_item_with_fallback("content_001", &vec!["application/xhtml+xml"])
                    .unwrap_err()
                    .to_string(),
                "No supported file format: The fallback resource does not contain the file format you support."
            );
        }

        /// ID: pub-foreign_image
        ///
        /// An HTML content file contains a PSD image, with a manifest fallback to a PNG image. This tests fallbacks for resources that are not in the spine.
        #[test]
        fn test_pub_foreign_image() {
            let epub_file = Path::new("./test_case/pub-foreign_image.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            let result = doc.get_manifest_item_with_fallback(
                "image-tiff",
                &vec!["image/png", "application/xhtml+xml"],
            );
            assert!(result.is_ok());

            let (_, mime) = result.unwrap();
            assert_eq!(mime, "image/png");
        }

        /// ID: pub-foreign_json-spine
        ///
        /// This EPUB uses a JSON content file in the spine, with a manifest fallback to an HTML document. If the reading system does not support JSON, it should display the HTML.
        #[test]
        fn test_pub_foreign_json_spine() {
            let epub_file = Path::new("./test_case/pub-foreign_json-spine.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            let result = doc.get_manifest_item_with_fallback(
                "content_primary",
                &vec!["application/xhtml+xml", "application/json"],
            );
            assert!(result.is_ok());
            let (_, mime) = result.unwrap();
            assert_eq!(mime, "application/json");

            let result = doc
                .get_manifest_item_with_fallback("content_primary", &vec!["application/xhtml+xml"]);
            assert!(result.is_ok());
            let (_, mime) = result.unwrap();
            assert_eq!(mime, "application/xhtml+xml");
        }

        /// ID: pub-foreign_xml-spine
        ///
        /// This EPUB uses an ordinary XML content file with mimetype application/xml in the spine, with a manifest fallback to an HTML document. If the reading system does not support XML, it should display the HTML.
        #[test]
        fn test_pub_foreign_xml_spine() {
            let epub_file = Path::new("./test_case/pub-foreign_xml-spine.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            let result = doc.get_manifest_item_with_fallback(
                "content_primary",
                &vec!["application/xhtml+xml", "application/xml"],
            );
            assert!(result.is_ok());
            let (_, mime) = result.unwrap();
            assert_eq!(mime, "application/xml");

            let result = doc
                .get_manifest_item_with_fallback("content_primary", &vec!["application/xhtml+xml"]);
            assert!(result.is_ok());
            let (_, mime) = result.unwrap();
            assert_eq!(mime, "application/xhtml+xml");
        }

        /// ID: pub-foreign_xml-suffix-spine
        ///
        /// This EPUB uses an custom XML content file with mimetype application/dtc+xml in the spine, with a manifest fallback to an HTML document. If the reading system does not support XML, it should display the HTML.
        #[test]
        fn test_pub_foreign_xml_suffix_spine() {
            let epub_file = Path::new("./test_case/pub-foreign_xml-suffix-spine.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            let result = doc.get_manifest_item_with_fallback(
                "content_primary",
                &vec!["application/xhtml+xml", "application/dtc+xml"],
            );
            assert!(result.is_ok());
            let (_, mime) = result.unwrap();
            assert_eq!(mime, "application/dtc+xml");

            let result = doc
                .get_manifest_item_with_fallback("content_primary", &vec!["application/xhtml+xml"]);
            assert!(result.is_ok());
            let (_, mime) = result.unwrap();
            assert_eq!(mime, "application/xhtml+xml");
        }
    }

    /// Section 3.9 open container format
    mod open_container_format_tests {
        use std::{cmp::min, io::Read, path::Path};

        use sha1::{Digest, Sha1};

        use crate::epub::EpubDoc;

        /// ID: ocf-metainf-inc
        ///
        /// An extra configuration file, not in the reserved files' list, is added to the META-INF folder; this file must be ignored.
        #[test]
        fn test_ocf_metainf_inc() {
            let epub_file = Path::new("./test_case/ocf-metainf-inc.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());
        }

        /// ID: ocf-metainf-manifest
        ///
        /// An ancillary manifest file, containing an extra spine item, is present in the META-INF directory; this extra item must be ignored by the reading system.
        #[test]
        fn test_ocf_metainf_manifest() {
            let epub_file = Path::new("./test_case/ocf-metainf-manifest.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());
        }

        /// ID: ocf-package_arbitrary
        ///
        /// The EPUB contains three valid package files and three corresponding sets of content documents, but only one of the packages, in an unusual subdirectory, is referenced by the container.xml file. The reading system must use this package.
        #[test]
        fn test_ocf_package_arbitrary() {
            let epub_file = Path::new("./test_case/ocf-package_arbitrary.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            assert_eq!(doc.package_path, Path::new("FOO/BAR/package.opf"));
        }

        /// ID: ocf-package_multiple
        ///
        /// The EPUB contains three valid package files and three corresponding sets of content documents, all referenced by the container.xml file. The reading system must use the first package.
        #[test]
        fn test_ocf_package_multiple() {
            let epub_file = Path::new("./test_case/ocf-package_multiple.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            assert_eq!(doc.package_path, Path::new("FOO/BAR/package.opf"));
            assert_eq!(doc.base_path, Path::new("FOO/BAR"));
        }

        /// ID: ocf-url_link-leaking-relative
        ///
        /// Use a relative link with several double-dot path segments from the content to a photograph. The folder hierarchy containing the photograph starts at the root level; the relative image reference exceeds depth of hierarchy.
        #[test]
        fn test_ocf_url_link_leaking_relative() {
            let epub_file = Path::new("./test_case/ocf-url_link-leaking-relative.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_err());
            assert_eq!(
                doc.err().unwrap().to_string(),
                String::from(
                    "Relative link leakage: Path \"../../../../media/imgs/monastery.jpg\" is out of container range."
                )
            )
        }

        /// ID: ocf-url_link-path-absolute
        ///
        /// Use a path-absolute link, i.e., beginning with a leading slash, from the content to a photograph. The folder hierarchy containing the photograph starts at the root level.
        #[test]
        fn test_ocf_url_link_path_absolute() {
            let epub_file = Path::new("./test_case/ocf-url_link-path-absolute.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            let resource = doc.manifest.get("photo").unwrap();
            assert_eq!(resource.path, Path::new("media/imgs/monastery.jpg"));
        }

        /// ID: ocf-url_link-relative
        ///
        /// A simple relative link from the content to a photograph. The folder hierarchy containing the photograph starts at the root level.
        #[test]
        fn test_ocf_url_link_relative() {
            let epub_file = Path::new("./test_case/ocf-url_link-relative.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            let resource = doc.manifest.get("photo").unwrap();
            assert_eq!(resource.path, Path::new("media/imgs/monastery.jpg"));
        }

        /// ID: ocf-url_manifest
        ///
        /// The manifest refers to an XHTML file in an arbitrary subfolder. The reading system must be able to find the content.
        #[test]
        fn test_ocf_url_manifest() {
            let epub_file = Path::new("./test_case/ocf-url_manifest.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            assert!(doc.get_manifest_item("nav").is_ok());
            assert!(doc.get_manifest_item("content_001").is_ok());
            assert!(doc.get_manifest_item("content_002").is_err());
        }

        /// ID: ocf-url_relative
        ///
        /// The manifest refers to an XHTML file in an arbitrary subfolder that is relative to the package's own arbitrary folder. The reading system must be able to find the content.
        #[test]
        fn test_ocf_url_relative() {
            let epub_file = Path::new("./test_case/ocf-url_relative.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            assert_eq!(doc.package_path, Path::new("foo/BAR/baz.opf"));
            assert_eq!(doc.base_path, Path::new("foo/BAR"));
            assert_eq!(
                doc.manifest.get("nav").unwrap().path,
                Path::new("foo/BAR/nav.xhtml")
            );
            assert_eq!(
                doc.manifest.get("content_001").unwrap().path,
                Path::new("foo/BAR/qux/content_001.xhtml")
            );
            assert!(doc.get_manifest_item("nav").is_ok());
            assert!(doc.get_manifest_item("content_001").is_ok());
        }

        /// ID: ocf-zip-comp
        ///
        /// MUST treat any OCF ZIP container that uses compression techniques other than Deflate as in error.
        /// This test case does not use compression methods other than Deflate and cannot detect whether it is effective.
        #[test]
        fn test_ocf_zip_comp() {
            let epub_file = Path::new("./test_case/ocf-zip-comp.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());
        }

        /// ID: ocf-zip-mult
        ///
        /// MUST treat any OCF ZIP container that splits the content into segments as in error.
        /// This test case is not a segmented OCF ZIP container and cannot be tested to see if it is valid.
        #[test]
        fn test_ocf_zip_mult() {
            let epub_file = Path::new("./test_case/ocf-zip-mult.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());
        }

        /// ID: ocf-font_obfuscation
        ///
        /// An obfuscated (TrueType) font should be displayed after de-obfuscation.
        #[test]
        fn test_ocf_font_obfuscation() {
            let epub_file = Path::new("./test_case/ocf-font_obfuscation.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            let unique_id = doc.unique_identifier.clone();

            let mut hasher = Sha1::new();
            hasher.update(unique_id.as_bytes());
            let hash = hasher.finalize();
            let mut key = vec![0u8; 1040];
            for i in 0..1040 {
                key[i] = hash[i % hash.len()];
            }

            assert!(doc.encryption.is_some());
            assert_eq!(doc.encryption.as_ref().unwrap().len(), 1);

            let data = &doc.encryption.unwrap()[0];
            assert_eq!(data.method, "http://www.idpf.org/2008/embedding");

            let font_file = doc
                .archive
                .lock()
                .unwrap()
                .by_name(&data.data)
                .unwrap()
                .bytes()
                .collect::<Result<Vec<u8>, _>>();
            assert!(font_file.is_ok());
            let font_file = font_file.unwrap();

            // 根据EPUB规范，字体混淆是直接对字体文件进行的，不需要解压步骤，直接进行去混淆处理
            let mut deobfuscated = font_file.clone();
            for i in 0..min(1040, deobfuscated.len()) {
                deobfuscated[i] ^= key[i];
            }

            assert!(is_valid_font(&deobfuscated));
        }

        /// ID: ocf-font_obfuscation-bis
        ///
        /// An obfuscated (TrueType) font should not be displayed after de-obfuscation, because the obfuscation used a different publication id.
        #[test]
        fn test_ocf_font_obfuscation_bis() {
            let epub_file = Path::new("./test_case/ocf-font_obfuscation_bis.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();

            let wrong_unique_id = "wrong-publication-id";
            let mut hasher = Sha1::new();
            hasher.update(wrong_unique_id.as_bytes());
            let hash = hasher.finalize();
            let mut wrong_key = vec![0u8; 1040];
            for i in 0..1040 {
                wrong_key[i] = hash[i % hash.len()];
            }

            assert!(doc.encryption.is_some());
            assert_eq!(doc.encryption.as_ref().unwrap().len(), 1);

            let data = &doc.encryption.unwrap()[0];
            assert_eq!(data.method, "http://www.idpf.org/2008/embedding");

            let font_file = doc
                .archive
                .lock()
                .unwrap()
                .by_name(&data.data)
                .unwrap()
                .bytes()
                .collect::<Result<Vec<u8>, _>>();
            assert!(font_file.is_ok());
            let font_file = font_file.unwrap();

            // 使用错误的密钥进行去混淆
            let mut deobfuscated_with_wrong_key = font_file.clone();
            for i in 0..std::cmp::min(1040, deobfuscated_with_wrong_key.len()) {
                deobfuscated_with_wrong_key[i] ^= wrong_key[i];
            }

            assert!(!is_valid_font(&deobfuscated_with_wrong_key));
        }

        fn is_valid_font(data: &[u8]) -> bool {
            if data.len() < 4 {
                return false;
            }
            let sig = &data[0..4];
            // OTF: "OTTO"
            // TTF: 0x00010000, 0x00020000, "true", "typ1"
            sig == b"OTTO"
                || sig == b"\x00\x01\x00\x00"
                || sig == b"\x00\x02\x00\x00"
                || sig == b"true"
                || sig == b"typ1"
        }
    }

    #[test]
    fn test_parse_container() {
        let epub_file = Path::new("./test_case/ocf-zip-mult.epub");
        let doc = EpubDoc::new(epub_file);
        assert!(doc.is_ok());

        // let doc = doc.unwrap();
        let container = r#"
        <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
            <rootfiles></rootfiles>
        </container>
        "#
        .to_string();

        let result = EpubDoc::<BufReader<File>>::parse_container(container);
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            EpubError::NonCanonicalFile { tag: "rootfile".to_string() }
        );

        let container = r#"
        <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
            <rootfiles>
                <rootfile media-type="application/oebps-package+xml"/>
            </rootfiles>
        </container>
        "#
        .to_string();

        let result = EpubDoc::<BufReader<File>>::parse_container(container);
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            EpubError::MissingRequiredAttribute {
                tag: "rootfile".to_string(),
                attribute: "full-path".to_string(),
            }
        );

        let container = r#"
        <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
            <rootfiles>
                <rootfile media-type="application/oebps-package+xml" full-path="EPUB/content.opf"/>
            </rootfiles>
        </container>
        "#
        .to_string();

        let result = EpubDoc::<BufReader<File>>::parse_container(container);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), PathBuf::from("EPUB/content.opf"))
    }

    #[test]
    fn test_parse_manifest() {
        let epub_file = Path::new("./test_case/ocf-package_multiple.epub");
        let doc = EpubDoc::new(epub_file);
        assert!(doc.is_ok());

        let manifest = r#"
        <manifest>
            <item href="content_001.xhtml" media-type="application/xhtml+xml"/>
            <item properties="nav" href="nav.xhtml" media-type="application/xhtml+xml"/>
        </manifest>
        "#;
        let mut doc = doc.unwrap();
        let element = XmlReader::parse(manifest);
        assert!(element.is_ok());

        let element = element.unwrap();
        let result = doc.parse_manifest(&element);
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            EpubError::MissingRequiredAttribute {
                tag: "item".to_string(),
                attribute: "id".to_string(),
            },
        );

        let manifest = r#"
        <manifest>
            <item id="content_001" media-type="application/xhtml+xml"/>
            <item id="nav" properties="nav" media-type="application/xhtml+xml"/>
        </manifest>
        "#;
        let element = XmlReader::parse(manifest);
        assert!(element.is_ok());

        let element = element.unwrap();
        let result = doc.parse_manifest(&element);
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            EpubError::MissingRequiredAttribute {
                tag: "item".to_string(),
                attribute: "href".to_string(),
            },
        );

        let manifest = r#"
        <manifest>
            <item id="content_001" href="content_001.xhtml"/>
            <item id="nav" properties="nav" href="nav.xhtml"/>
        </manifest>
        "#;
        let element = XmlReader::parse(manifest);
        assert!(element.is_ok());

        let element = element.unwrap();
        let result = doc.parse_manifest(&element);
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            EpubError::MissingRequiredAttribute {
                tag: "item".to_string(),
                attribute: "media-type".to_string(),
            },
        );

        let manifest = r#"
        <manifest>
            <item id="content_001" href="content_001.xhtml" media-type="application/xhtml+xml"/>
            <item id="nav" properties="nav" href="nav.xhtml" media-type="application/xhtml+xml"/>
        </manifest>
        "#;
        let element = XmlReader::parse(manifest);
        assert!(element.is_ok());

        let element = element.unwrap();
        let result = doc.parse_manifest(&element);
        assert!(result.is_ok());
    }

    /// Test for function `has_encryption`
    #[test]
    fn test_fn_has_encryption() {
        let epub_file = Path::new("./test_case/ocf-font_obfuscation.epub");
        let doc = EpubDoc::new(epub_file);
        assert!(doc.is_ok());

        let doc = doc.unwrap();
        assert!(doc.has_encryption());
    }

    /// This test is used to detect whether the "META-INF/encryption.xml" file is parsed correctly
    #[test]
    fn test_fn_parse_encryption() {
        let epub_file = Path::new("./test_case/ocf-font_obfuscation.epub");
        let doc = EpubDoc::new(epub_file);
        assert!(doc.is_ok());

        let doc = doc.unwrap();
        assert!(doc.encryption.is_some());

        let encryption = doc.encryption.unwrap();
        assert_eq!(encryption.len(), 1);
        assert_eq!(encryption[0].method, "http://www.idpf.org/2008/embedding");
        assert_eq!(encryption[0].data, "EPUB/fonts/Lobster.ttf");
    }

    #[test]
    fn test_get_metadata_existing_key() {
        let epub_file = Path::new("./test_case/epub-33.epub");
        let doc = EpubDoc::new(epub_file);
        assert!(doc.is_ok());

        let doc = doc.unwrap();

        let titles = doc.get_metadata("title");
        assert!(titles.is_some());

        let titles = titles.unwrap();
        assert_eq!(titles.len(), 1);
        assert_eq!(titles[0].property, "title");
        assert_eq!(titles[0].value, "EPUB 3.3");

        let languages = doc.get_metadata("language");
        assert!(languages.is_some());

        let languages = languages.unwrap();
        assert_eq!(languages.len(), 1);
        assert_eq!(languages[0].property, "language");
        assert_eq!(languages[0].value, "en-us");

        let language = doc.get_language();
        assert_eq!(language, vec!["en-us"]);
    }

    #[test]
    fn test_get_metadata_nonexistent_key() {
        let epub_file = Path::new("./test_case/epub-33.epub");
        let doc = EpubDoc::new(epub_file);
        assert!(doc.is_ok());

        let doc = doc.unwrap();
        let metadata = doc.get_metadata("nonexistent");
        assert!(metadata.is_none());
    }

    #[test]
    fn test_get_metadata_multiple_items_same_type() {
        let epub_file = Path::new("./test_case/epub-33.epub");
        let doc = EpubDoc::new(epub_file);
        assert!(doc.is_ok());

        let doc = doc.unwrap();

        let creators = doc.get_metadata("creator");
        assert!(creators.is_some());

        let creators = creators.unwrap();
        assert_eq!(creators.len(), 3);

        assert_eq!(creators[0].id, Some("creator_id_0".to_string()));
        assert_eq!(creators[0].property, "creator");
        assert_eq!(creators[0].value, "Matt Garrish, DAISY Consortium");

        assert_eq!(creators[1].id, Some("creator_id_1".to_string()));
        assert_eq!(creators[1].property, "creator");
        assert_eq!(creators[1].value, "Ivan Herman, W3C");

        assert_eq!(creators[2].id, Some("creator_id_2".to_string()));
        assert_eq!(creators[2].property, "creator");
        assert_eq!(creators[2].value, "Dave Cramer, Invited Expert");
    }

    #[test]
    fn test_get_metadata_with_refinement() {
        let epub_file = Path::new("./test_case/epub-33.epub");
        let doc = EpubDoc::new(epub_file);
        assert!(doc.is_ok());

        let doc = doc.unwrap();

        let title = doc.get_metadata("title");
        assert!(title.is_some());

        let title = title.unwrap();
        assert_eq!(title.len(), 1);
        assert_eq!(title[0].refined.len(), 1);
        assert_eq!(title[0].refined[0].property, "title-type");
        assert_eq!(title[0].refined[0].value, "main");
    }

    #[test]
    fn test_get_manifest_item_with_fallback() {
        let epub_file = Path::new("./test_case/pub-foreign_bad-fallback.epub");
        let doc = EpubDoc::new(epub_file);
        assert!(doc.is_ok());

        let doc = doc.unwrap();
        assert!(doc.get_manifest_item("content_001").is_ok());
        assert!(doc.get_manifest_item("bar").is_ok());

        // 当回退链上存在可回退资源时能获取资源
        if let Ok((_, mime)) =
            doc.get_manifest_item_with_fallback("content_001", &vec!["image/psd"])
        {
            assert_eq!(mime, "image/psd");
        } else {
            assert!(false, "get_manifest_item_with_fallback failed");
        }

        // 当回退链上不存在可回退资源时无法获取资源
        assert_eq!(
            doc.get_manifest_item_with_fallback("content_001", &vec!["application/xhtml+xml"])
                .unwrap_err()
                .to_string(),
            "No supported file format: The fallback resource does not contain the file format you support."
        );
    }

    #[test]
    fn test_get_cover() {
        let epub_file = Path::new("./test_case/pkg-cover-image.epub");
        let doc = EpubDoc::new(epub_file);
        if let Err(err) = &doc {
            println!("{}", err);
        }
        assert!(doc.is_ok());

        let doc = doc.unwrap();
        let result = doc.get_cover();
        assert!(result.is_some());

        let (data, mime) = result.unwrap();
        assert_eq!(data.len(), 5785);
        assert_eq!(mime, "image/jpeg");
    }

    #[test]
    fn test_epub_2() {
        let epub_file = Path::new("./test_case/epub-2.epub");
        let doc = EpubDoc::new(epub_file);
        assert!(doc.is_ok());

        let doc = doc.unwrap();

        let titles = doc.get_title();
        assert_eq!(titles, vec!["Minimal EPUB 2.0"]);
    }

    #[test]
    fn test_is_valid_epub_valid_file() {
        let result = EpubDoc::is_valid_epub("./test_case/epub-2.epub");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), true);
    }

    #[test]
    fn test_is_valid_epub_invalid_path() {
        let result = EpubDoc::is_valid_epub("./test_case/nonexistent.epub");
        assert!(result.is_err());
    }

    #[test]
    fn test_is_valid_epub_corrupted_zip() {
        let temp_dir = std::env::temp_dir();
        let corrupted_file = temp_dir.join("corrupted.epub");

        std::fs::write(&corrupted_file, b"not a valid zip file").unwrap();

        let result = EpubDoc::is_valid_epub(&corrupted_file);

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, EpubError::ArchiveError { .. }));

        std::fs::remove_file(corrupted_file).ok();
    }

    #[test]
    fn test_is_valid_epub_valid_epub_3() {
        let result = EpubDoc::is_valid_epub("./test_case/epub-33.epub");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), true);
    }

    #[test]
    fn test_is_outside_error() {
        let archive_error = EpubError::ArchiveError {
            source: zip::result::ZipError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                "test",
            )),
        };
        assert!(EpubDoc::<BufReader<File>>::is_outside_error(&archive_error));

        let io_error = EpubError::IOError {
            source: std::io::Error::new(std::io::ErrorKind::NotFound, "test"),
        };
        assert!(EpubDoc::<BufReader<File>>::is_outside_error(&io_error));

        let non_canonical = EpubError::NonCanonicalEpub { expected_file: "test".to_string() };
        assert!(!EpubDoc::<BufReader<File>>::is_outside_error(
            &non_canonical
        ));

        let missing_attr = EpubError::MissingRequiredAttribute {
            tag: "test".to_string(),
            attribute: "id".to_string(),
        };
        assert!(!EpubDoc::<BufReader<File>>::is_outside_error(&missing_attr));
    }

    mod metadata_sheet_tests {
        use crate::epub::EpubDoc;
        use std::path::Path;

        #[test]
        fn test_get_metadata_sheet_basic_fields() {
            let epub_file = Path::new("./test_case/epub-33.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            let sheet = doc.get_metadata_sheet();

            assert_eq!(sheet.title.len(), 1);
            assert_eq!(sheet.title[0], "EPUB 3.3");

            assert_eq!(sheet.language.len(), 1);
            assert_eq!(sheet.language[0], "en-us");

            assert_eq!(sheet.publisher, "World Wide Web Consortium");

            assert_eq!(
                sheet.rights,
                "https://www.w3.org/Consortium/Legal/2015/doc-license"
            );
        }

        #[test]
        fn test_get_metadata_sheet_multiple_creators() {
            let epub_file = Path::new("./test_case/epub-33.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            let sheet = doc.get_metadata_sheet();

            assert_eq!(sheet.creator.len(), 3);
            assert_eq!(sheet.creator[0], "Matt Garrish, DAISY Consortium");
            assert_eq!(sheet.creator[1], "Ivan Herman, W3C");
            assert_eq!(sheet.creator[2], "Dave Cramer, Invited Expert");
        }

        #[test]
        fn test_get_metadata_sheet_multiple_subjects() {
            let epub_file = Path::new("./test_case/epub-33.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            let sheet = doc.get_metadata_sheet();

            assert_eq!(sheet.subject.len(), 2);
            assert_eq!(sheet.subject[0], "Information systems~World Wide Web");
            assert_eq!(
                sheet.subject[1],
                "General and reference~Computing standards, RFCs and guidelines"
            );
        }

        #[test]
        fn test_get_metadata_sheet_identifier_with_id() {
            let epub_file = Path::new("./test_case/epub-33.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            let sheet = doc.get_metadata_sheet();

            assert!(sheet.identifier.contains_key("pub-id"));
            assert_eq!(
                sheet.identifier.get("pub-id"),
                Some(&"https://www.w3.org/TR/epub-33/".to_string())
            );
        }

        #[test]
        fn test_get_metadata_sheet_missing_scalar_fields() {
            let epub_file = Path::new("./test_case/epub-33.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            let sheet = doc.get_metadata_sheet();

            assert!(sheet.coverage.is_empty());
            assert!(sheet.description.is_empty());
            assert!(sheet.format.is_empty());
            assert!(sheet.source.is_empty());
            assert!(sheet.epub_type.is_empty());
            assert!(sheet.contributor.is_empty());
            assert!(sheet.relation.is_empty());
        }

        #[test]
        fn test_get_metadata_sheet_title_refinement_via_get_metadata() {
            let epub_file = Path::new("./test_case/epub-33.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            let title_metadata = doc.get_metadata("title");
            assert!(title_metadata.is_some());

            let title_metadata = title_metadata.unwrap();
            assert_eq!(title_metadata.len(), 1);
            assert_eq!(title_metadata[0].refined.len(), 1);
            assert_eq!(title_metadata[0].refined[0].property, "title-type");
            assert_eq!(title_metadata[0].refined[0].value, "main");

            let sheet = doc.get_metadata_sheet();
            assert_eq!(sheet.title.len(), 1);
            assert_eq!(sheet.title[0], "EPUB 3.3");
        }

        #[test]
        fn test_get_metadata_sheet_ignores_unknown_properties() {
            let epub_file = Path::new("./test_case/epub-33.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            let sheet = doc.get_metadata_sheet();

            assert_eq!(sheet.title.len(), 1);
            assert_eq!(sheet.creator.len(), 3);
            assert_eq!(sheet.subject.len(), 2);
        }

        #[test]
        fn test_get_metadata_sheet_idempotent() {
            let epub_file = Path::new("./test_case/epub-33.epub");
            let doc = EpubDoc::new(epub_file);
            assert!(doc.is_ok());

            let doc = doc.unwrap();
            let sheet1 = doc.get_metadata_sheet();
            let sheet2 = doc.get_metadata_sheet();

            assert_eq!(sheet1.title, sheet2.title);
            assert_eq!(sheet1.creator, sheet2.creator);
            assert_eq!(sheet1.language, sheet2.language);
            assert_eq!(sheet1.identifier, sheet2.identifier);
            assert_eq!(sheet1.date, sheet2.date);
        }
    }
}
