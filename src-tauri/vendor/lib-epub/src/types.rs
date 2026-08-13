//! Types and data structures for EPUB processing
//!
//! This module defines all the core data structures used throughout the EPUB library.
//! These structures represent the various components of an EPUB publication according to
//! the EPUB specification, including metadata, manifest items, spine items, navigation points,
//! and encryption information.
//!
//! The types in this module are designed to be compatible with both EPUB 2 and EPUB 3
//! specifications, providing a unified interface for working with different versions
//! of EPUB publications.
//!
//! ## Builder Pattern
//!
//! Many of these types implement a builder pattern for easier construction when the
//! `builder` feature is enabled. See individual type documentation for details.

use std::{collections::HashMap, path::PathBuf};

#[cfg(feature = "builder")]
use crate::{
    error::{EpubBuilderError, EpubError},
    utils::ELEMENT_IN_DC_NAMESPACE,
};

/// Represents the EPUB version
///
/// This enum is used to distinguish between different versions of the EPUB specification.
#[derive(Debug, PartialEq, Eq)]
pub enum EpubVersion {
    Version2_0,
    Version3_0,
}

/// Represents a metadata item in the EPUB publication
///
/// The `MetadataItem` structure represents a single piece of metadata from the EPUB publication.
/// Metadata items contain information about the publication such as title, author, identifier,
/// language, and other descriptive information.
///
/// In EPUB 3.0, metadata items can have refinements that provide additional details about
/// the main metadata item. For example, a title metadata item might have refinements that
/// specify it is the main title of the publication.
///
/// ## Builder Methods
///
/// When the `builder` feature is enabled, this struct provides convenient builder methods:
///
/// ```rust
/// # #[cfg(feature = "builder")] {
/// use lib_epub::types::MetadataItem;
///
/// let metadata = MetadataItem::new("title", "Sample Book")
///     .with_id("title-1")
///     .with_lang("en")
///     .build();
/// # }
/// ```
#[derive(Debug, Clone)]
pub struct MetadataItem {
    /// Optional unique identifier for this metadata item
    ///
    /// Used to reference this metadata item from other elements or refinements.
    /// In EPUB 3.0, this ID is particularly important for linking with metadata refinements.
    pub id: Option<String>,

    /// The metadata property name
    ///
    /// This field specifies the type of metadata this item represents. Common properties
    /// include "title", "creator", "identifier", "language", "publisher", etc.
    /// These typically correspond to Dublin Core metadata terms.
    pub property: String,

    /// The metadata value
    pub value: String,

    /// Optional language code for this metadata item
    pub lang: Option<String>,

    /// Refinements of this metadata item
    ///
    /// In EPUB 3.x, metadata items can have associated refinements that provide additional
    /// information about the main metadata item. For example, a creator metadata item might
    /// have refinements specifying the creator's role (author, illustrator, etc.) or file-as.
    ///
    /// In EPUB 2.x, metadata items may contain custom attributes, which will also be parsed as refinement.
    pub refined: Vec<MetadataRefinement>,
}

#[cfg(feature = "builder")]
impl MetadataItem {
    /// Creates a new metadata item with the given property and value
    ///
    /// Requires the `builder` feature.
    ///
    /// ## Parameters
    /// - `property` - The metadata property name (e.g., "title", "creator")
    /// - `value` - The metadata value
    pub fn new(property: &str, value: &str) -> Self {
        Self {
            id: None,
            property: property.to_string(),
            value: value.to_string(),
            lang: None,
            refined: vec![],
        }
    }

    /// Sets the ID of the metadata item
    ///
    /// Requires the `builder` feature.
    ///
    /// ## Parameters
    /// - `id` - The ID to assign to this metadata item
    pub fn with_id(&mut self, id: &str) -> &mut Self {
        self.id = Some(id.to_string());
        self
    }

    /// Sets the language of the metadata item
    ///
    /// Requires the `builder` feature.
    ///
    /// ## Parameters
    /// - `lang` - The language code (e.g., "en", "fr", "zh-CN")
    pub fn with_lang(&mut self, lang: &str) -> &mut Self {
        self.lang = Some(lang.to_string());
        self
    }

    /// Adds a refinement to this metadata item
    ///
    /// Requires the `builder` feature.
    ///
    /// ## Parameters
    /// - `refine` - The refinement to add
    ///
    /// ## Notes
    /// - The metadata item must have an ID for refinements to be added.
    pub fn append_refinement(&mut self, refine: MetadataRefinement) -> &mut Self {
        if self.id.is_some() {
            self.refined.push(refine);
        } else {
            // TODO: alert warning
        }

        self
    }

    /// Builds the final metadata item
    ///
    /// Requires the `builder` feature.
    pub fn build(&self) -> Self {
        Self { ..self.clone() }
    }

    /// Gets the XML attributes for this metadata item
    pub(crate) fn attributes(&self) -> Vec<(&str, &str)> {
        let mut attributes = Vec::new();

        if !ELEMENT_IN_DC_NAMESPACE.contains(&self.property.as_str()) {
            attributes.push(("property", self.property.as_str()));
        }

        if let Some(id) = &self.id {
            attributes.push(("id", id.as_str()));
        };

        if let Some(lang) = &self.lang {
            attributes.push(("lang", lang.as_str()));
        };

        attributes
    }
}

/// Represents a refinement of a metadata item in an EPUB 3.0 publication
///
/// The `MetadataRefinement` structure provides additional details about a parent metadata item.
/// Refinements are used in EPUB 3.0 to add granular metadata information that would be difficult
/// to express with the basic metadata structure alone.
///
/// For example, a creator metadata item might have refinements specifying the creator's role
/// or the scheme used for an identifier.
///
/// ## Builder Methods
///
/// When the `builder` feature is enabled, this struct provides convenient builder methods:
///
/// ```rust
/// # #[cfg(feature = "builder")] {
/// use lib_epub::types::MetadataRefinement;
///
/// let refinement = MetadataRefinement::new("creator-1", "role", "author")
///     .with_lang("en")
///     .with_scheme("marc:relators")
///     .build();
/// # }
/// ```
#[derive(Debug, Clone)]
pub struct MetadataRefinement {
    pub refines: String,

    /// The refinement property name
    ///
    /// Specifies what aspect of the parent metadata item this refinement describes.
    /// Common refinement properties include "role", "file-as", "alternate-script", etc.
    pub property: String,

    /// The refinement value
    pub value: String,

    /// Optional language code for this refinement
    pub lang: Option<String>,

    /// Optional scheme identifier for this refinement
    ///
    /// Specifies the vocabulary or scheme used for the refinement value. For example,
    /// "marc:relators" for MARC relator codes, or "onix:codelist5" for ONIX roles.
    pub scheme: Option<String>,
}

#[cfg(feature = "builder")]
impl MetadataRefinement {
    /// Creates a new metadata refinement
    ///
    /// Requires the `builder` feature.
    ///
    /// ## Parameters
    /// - `refines` - The ID of the metadata item being refined
    /// - `property` - The refinement property name
    /// - `value` - The refinement value
    pub fn new(refines: &str, property: &str, value: &str) -> Self {
        Self {
            refines: refines.to_string(),
            property: property.to_string(),
            value: value.to_string(),
            lang: None,
            scheme: None,
        }
    }

    /// Sets the language of the refinement
    ///
    /// Requires the `builder` feature.
    ///
    /// ## Parameters
    /// - `lang` - The language code
    pub fn with_lang(&mut self, lang: &str) -> &mut Self {
        self.lang = Some(lang.to_string());
        self
    }

    /// Sets the scheme of the refinement
    ///
    /// Requires the `builder` feature.
    ///
    /// ## Parameters
    /// - `scheme` - The scheme identifier
    pub fn with_scheme(&mut self, scheme: &str) -> &mut Self {
        self.scheme = Some(scheme.to_string());
        self
    }

    /// Builds the final metadata refinement
    ///
    /// Requires the `builder` feature.
    pub fn build(&self) -> Self {
        Self { ..self.clone() }
    }

    /// Gets the XML attributes for this refinement
    pub(crate) fn attributes(&self) -> Vec<(&str, &str)> {
        let mut attributes = Vec::new();

        attributes.push(("refines", self.refines.as_str()));
        attributes.push(("property", self.property.as_str()));

        if let Some(lang) = &self.lang {
            attributes.push(("lang", lang.as_str()));
        };

        if let Some(scheme) = &self.scheme {
            attributes.push(("scheme", scheme.as_str()));
        };

        attributes
    }
}

/// Represents a metadata link item in an EPUB publication
///
/// The `MetadataLinkItem` structure represents a link from the publication's metadata to
/// external resources. These links are typically used to associate the publication with
/// external records, alternate editions, or related resources.
///
/// Link metadata items are defined in the OPF file using `<link>` elements in the metadata
/// section and follow the EPUB 3.0 metadata link specification.
#[derive(Debug)]
pub struct MetadataLinkItem {
    /// The URI of the linked resource
    pub href: String,

    /// The relationship between this publication and the linked resource
    pub rel: String,

    /// Optional language of the linked resource
    pub hreflang: Option<String>,

    /// Optional unique identifier for this link item
    ///
    /// Provides an ID that can be used to reference this link from other elements.
    pub id: Option<String>,

    /// Optional MIME type of the linked resource
    pub mime: Option<String>,

    /// Optional properties of this link
    ///
    /// Contains space-separated property values that describe characteristics of the link
    /// or the linked resource. For example, "onix-3.0" to indicate an ONIX 3.0 record.
    pub properties: Option<String>,

    /// Optional reference to another metadata item
    ///
    /// In EPUB 3.0, links can refine other metadata items. This field contains the ID
    /// of the metadata item that this link refines, prefixed with "#".
    pub refines: Option<String>,
}

/// A unified metadata sheet for EPUB publications
///
/// This struct provides a simplified, high-level interface for accessing EPUB metadata.
/// It consolidates metadata from both EPUB 2 and EPUB 3 specifications into a single
/// convenient structure, with separate storage for multi-value fields and single-value fields.
#[derive(Debug, Default)]
pub struct MetadataSheet {
    /// Contributors to the publication (e.g., editors, translators)
    pub contributor: Vec<String>,
    /// Primary creators/authors of the publication
    pub creator: Vec<String>,
    /// Date information with optional event types (e.g., publication, creation)
    pub date: HashMap<String, String>,
    /// Unique identifiers with their assigned IDs as keys
    pub identifier: HashMap<String, String>,
    /// Language codes for the publication content
    pub language: Vec<String>,
    /// References to related resources
    pub relation: Vec<String>,
    /// Subject keywords or topics
    pub subject: Vec<String>,
    /// Title(s) of the publication
    pub title: Vec<String>,

    /// Spatial or temporal coverage of the publication
    pub coverage: String,
    /// Description or abstract of the publication
    pub description: String,
    /// Physical or digital format of the publication
    pub format: String,
    /// Publisher information
    pub publisher: String,
    /// Copyright and licensing rights
    pub rights: String,
    /// Reference to the source publication
    pub source: String,
    /// EPUB-specific type identifier
    pub epub_type: String,
}

impl MetadataSheet {
    /// Creates a new MetadataSheet instance
    pub fn new() -> Self {
        Self {
            contributor: Vec::new(),
            creator: Vec::new(),
            date: HashMap::new(),
            identifier: HashMap::new(),
            language: Vec::new(),
            relation: Vec::new(),
            subject: Vec::new(),
            title: Vec::new(),

            coverage: String::new(),
            description: String::new(),
            format: String::new(),
            publisher: String::new(),
            rights: String::new(),
            source: String::new(),
            epub_type: String::new(),
        }
    }
}

#[cfg(feature = "builder")]
impl MetadataSheet {
    /// Appends a contributor to the metadata
    pub fn append_contributor(&mut self, contributor: impl Into<String>) -> &mut Self {
        self.contributor.push(contributor.into());
        self
    }

    /// Appends a creator to the metadata
    pub fn append_creator(&mut self, creator: impl Into<String>) -> &mut Self {
        self.creator.push(creator.into());
        self
    }

    /// Appends a language to the metadata
    pub fn append_language(&mut self, language: impl Into<String>) -> &mut Self {
        self.language.push(language.into());
        self
    }

    /// Appends a relation to the metadata
    pub fn append_relation(&mut self, relation: impl Into<String>) -> &mut Self {
        self.relation.push(relation.into());
        self
    }

    /// Appends a subject to the metadata
    pub fn append_subject(&mut self, subject: impl Into<String>) -> &mut Self {
        self.subject.push(subject.into());
        self
    }

    /// Appends a title to the metadata
    pub fn append_title(&mut self, title: impl Into<String>) -> &mut Self {
        self.title.push(title.into());
        self
    }

    /// Sets a date value with optional event type
    ///
    /// Parameters:
    /// - `date`: The date value (used as key to allow multiple dates)
    /// - `event`: Optional event type (e.g., "publication", "creation", "modification")
    ///
    /// Note: Multiple dates can be stored. The date string is used as the key,
    /// and the event type (if any) is stored as the value.
    pub fn append_date(&mut self, date: impl Into<String>, event: impl Into<String>) -> &mut Self {
        self.date.insert(date.into(), event.into());
        self
    }

    /// Sets an identifier with id (e.g., "book-id", "isbn-id")
    pub fn append_identifier(
        &mut self,
        id: impl Into<String>,
        value: impl Into<String>,
    ) -> &mut Self {
        self.identifier.insert(id.into(), value.into());
        self
    }

    /// Sets coverage
    pub fn with_coverage(&mut self, coverage: impl Into<String>) -> &mut Self {
        self.coverage = coverage.into();
        self
    }

    /// Sets description
    pub fn with_description(&mut self, description: impl Into<String>) -> &mut Self {
        self.description = description.into();
        self
    }

    /// Sets format
    pub fn with_format(&mut self, format: impl Into<String>) -> &mut Self {
        self.format = format.into();
        self
    }

    /// Sets publisher
    pub fn with_publisher(&mut self, publisher: impl Into<String>) -> &mut Self {
        self.publisher = publisher.into();
        self
    }

    /// Sets rights
    pub fn with_rights(&mut self, rights: impl Into<String>) -> &mut Self {
        self.rights = rights.into();
        self
    }

    /// Sets source
    pub fn with_source(&mut self, source: impl Into<String>) -> &mut Self {
        self.source = source.into();
        self
    }

    /// Sets epub type
    pub fn with_epub_type(&mut self, epub_type: impl Into<String>) -> &mut Self {
        self.epub_type = epub_type.into();
        self
    }

    /// Builds the Metadata instance (returns a clone)
    pub fn build(&self) -> MetadataSheet {
        MetadataSheet {
            contributor: self.contributor.clone(),
            creator: self.creator.clone(),
            date: self.date.clone(),
            identifier: self.identifier.clone(),
            language: self.language.clone(),
            relation: self.relation.clone(),
            subject: self.subject.clone(),
            title: self.title.clone(),
            coverage: self.coverage.clone(),
            description: self.description.clone(),
            format: self.format.clone(),
            publisher: self.publisher.clone(),
            rights: self.rights.clone(),
            source: self.source.clone(),
            epub_type: self.epub_type.clone(),
        }
    }
}

#[cfg(feature = "builder")]
impl From<MetadataSheet> for Vec<MetadataItem> {
    /// Converts a `MetadataSheet` into a `Vec<MetadataItem>` for EPUB use
    ///
    /// This conversion maps Dublin Core metadata fields from `MetadataSheet` to
    /// the EPUB-compliant `MetadataItem` format. Each field in `MetadataSheet`
    /// is converted to a corresponding `MetadataItem`.
    fn from(sheet: MetadataSheet) -> Vec<MetadataItem> {
        let mut items = Vec::new();

        // Dublin Core Vector Fields - multiple values become separate MetadataItems

        for title in &sheet.title {
            items.push(MetadataItem::new("title", title));
        }

        for creator in &sheet.creator {
            items.push(MetadataItem::new("creator", creator));
        }

        for contributor in &sheet.contributor {
            items.push(MetadataItem::new("contributor", contributor));
        }

        for subject in &sheet.subject {
            items.push(MetadataItem::new("subject", subject));
        }

        for language in &sheet.language {
            items.push(MetadataItem::new("language", language));
        }

        for relation in &sheet.relation {
            items.push(MetadataItem::new("relation", relation));
        }

        // Dublin Core HashMap Fields - date and identifier have key-value structure
        // For date: key is used as refinement property "event", value is the date
        // For identifier: key is used as the xml:id attribute
        for (date, event) in &sheet.date {
            let mut item = MetadataItem::new("date", date);
            if !event.is_empty() {
                let refinement_id = format!("date-{}", items.len());
                item.id = Some(refinement_id.clone());
                item.refined
                    .push(MetadataRefinement::new(&refinement_id, "event", event));
            }
            items.push(item);
        }

        for (id, value) in &sheet.identifier {
            let mut item = MetadataItem::new("identifier", value);
            if !id.is_empty() {
                item.id = Some(id.clone());
            }
            items.push(item);
        }

        // Dublin Core Scalar Fields - single-value fields

        if !sheet.description.is_empty() {
            items.push(MetadataItem::new("description", &sheet.description));
        }

        if !sheet.format.is_empty() {
            items.push(MetadataItem::new("format", &sheet.format));
        }

        if !sheet.publisher.is_empty() {
            items.push(MetadataItem::new("publisher", &sheet.publisher));
        }

        if !sheet.rights.is_empty() {
            items.push(MetadataItem::new("rights", &sheet.rights));
        }

        if !sheet.source.is_empty() {
            items.push(MetadataItem::new("source", &sheet.source));
        }

        if !sheet.coverage.is_empty() {
            items.push(MetadataItem::new("coverage", &sheet.coverage));
        }

        if !sheet.epub_type.is_empty() {
            items.push(MetadataItem::new("type", &sheet.epub_type));
        }

        items
    }
}

/// Represents a resource item declared in the EPUB manifest
///
/// The `ManifestItem` structure represents a single resource file declared in the EPUB
/// publication's manifest. Each manifest item describes a resource that is part of the
/// publication, including its location, media type, and optional properties or fallback
/// relationships.
///
/// The manifest serves as a comprehensive inventory of all resources in an EPUB publication.
/// Every resource that is part of the publication must be declared in the manifest, and
/// resources not listed in the manifest should not be accessed by reading systems.
///
/// Manifest items support the fallback mechanism, allowing alternative versions of a resource
/// to be specified. This is particularly important for foreign resources (resources with
/// non-core media types) that may not be supported by all reading systems.
///
/// ## Builder Methods
///
/// When the `builder` feature is enabled, this struct provides convenient builder methods:
///
/// ```
/// # #[cfg(feature = "builder")] {
/// use lib_epub::types::ManifestItem;
///
/// let manifest_item = ManifestItem::new("cover", "images/cover.jpg")
///     .unwrap()
///     .append_property("cover-image")
///     .with_fallback("cover-fallback")
///     .build();
/// # }
/// ```
#[derive(Debug, Clone)]
pub struct ManifestItem {
    /// The unique identifier for this resource item
    pub id: String,

    /// The path to the resource file within the EPUB container
    ///
    /// This field contains the normalized path to the resource file relative to the
    /// root of the EPUB container. The path is processed during parsing to handle
    /// various EPUB path conventions (absolute paths, relative paths, etc.).
    pub path: PathBuf,

    /// The media type of the resource
    pub mime: String,

    /// Optional properties associated with this resource
    ///
    /// This field contains a space-separated list of properties that apply to this
    /// resource. Properties provide additional information about how the resource
    /// should be treated.
    pub properties: Option<String>,

    /// Optional fallback resource identifier
    ///
    /// This field specifies the ID of another manifest item that serves as a fallback
    /// for this resource. Fallbacks are used when a reading system does not support
    /// the media type of the primary resource. The fallback chain allows publications
    /// to include foreign resources while maintaining compatibility with older or
    /// simpler reading systems.
    ///
    /// The value is the ID of another manifest item, which must exist in the manifest.
    /// If `None`, this resource has no fallback.
    pub fallback: Option<String>,
}

#[cfg(feature = "builder")]
impl ManifestItem {
    /// Creates a new manifest item
    ///
    /// Requires the `builder` feature.
    ///
    /// ## Parameters
    /// - `id` - The unique identifier for this resource
    /// - `path` - The path to the resource file
    ///
    /// ## Errors
    /// Returns an error if the path starts with "../" which is not allowed.
    pub fn new(id: &str, path: &str) -> Result<Self, EpubError> {
        if path.starts_with("../") {
            return Err(
                EpubBuilderError::IllegalManifestPath { manifest_id: id.to_string() }.into(),
            );
        }

        Ok(Self {
            id: id.to_string(),
            path: PathBuf::from(path),
            mime: String::new(),
            properties: None,
            fallback: None,
        })
    }

    /// Sets the MIME type of the manifest item
    pub(crate) fn set_mime(self, mime: &str) -> Self {
        Self {
            id: self.id,
            path: self.path,
            mime: mime.to_string(),
            properties: self.properties,
            fallback: self.fallback,
        }
    }

    /// Appends a property to the manifest item
    ///
    /// Requires the `builder` feature.
    ///
    /// ## Parameters
    /// - `property` - The property to add
    pub fn append_property(&mut self, property: &str) -> &mut Self {
        let new_properties = if let Some(properties) = &self.properties {
            format!("{} {}", properties, property)
        } else {
            property.to_string()
        };

        self.properties = Some(new_properties);
        self
    }

    /// Sets the fallback for this manifest item
    ///
    /// Requires the `builder` feature.
    ///
    /// ## Parameters
    /// - `fallback` - The ID of the fallback manifest item
    pub fn with_fallback(&mut self, fallback: &str) -> &mut Self {
        self.fallback = Some(fallback.to_string());
        self
    }

    /// Builds the final manifest item
    ///
    /// Requires the `builder` feature.
    pub fn build(&self) -> Self {
        Self { ..self.clone() }
    }

    /// Gets the XML attributes for this manifest item
    pub fn attributes(&self) -> Vec<(&str, &str)> {
        let mut attributes = Vec::new();

        attributes.push(("id", self.id.as_str()));
        attributes.push(("href", self.path.to_str().unwrap()));
        attributes.push(("media-type", self.mime.as_str()));

        if let Some(properties) = &self.properties {
            attributes.push(("properties", properties.as_str()));
        }

        if let Some(fallback) = &self.fallback {
            attributes.push(("fallback", fallback.as_str()));
        }

        attributes
    }
}

/// Represents an item in the EPUB spine, defining the reading order of the publication
///
/// The `SpineItem` structure represents a single item in the EPUB spine, which defines
/// the linear reading order of the publication's content documents. Each spine item
/// references a resource declared in the manifest and indicates whether it should be
/// included in the linear reading sequence.
///
/// The spine is a crucial component of an EPUB publication as it determines the recommended
/// reading order of content documents. Items can be marked as linear (part of the main reading
/// flow) or non-linear (supplementary content that may be accessed out of sequence).
///
/// ## Builder Methods
///
/// When the `builder` feature is enabled, this struct provides convenient builder methods:
///
/// ```
/// # #[cfg(feature = "builder")] {
/// use lib_epub::types::SpineItem;
///
/// let spine_item = SpineItem::new("content-1")
///     .with_id("spine-1")
///     .append_property("page-spread-right")
///     .set_linear(false)
///     .build();
/// # }
/// ```
#[derive(Debug, Clone)]
pub struct SpineItem {
    /// The ID reference to a manifest item
    ///
    /// This field contains the ID of the manifest item that this spine item references.
    /// It establishes the connection between the reading order (spine) and the actual
    /// content resources (manifest). The referenced ID must exist in the manifest.
    pub idref: String,

    /// Optional identifier for this spine item
    pub id: Option<String>,

    /// Optional properties associated with this spine item
    ///
    /// This field contains a space-separated list of properties that apply to this
    /// spine item. These properties can indicate special handling requirements,
    /// layout preferences, or other characteristics.
    pub properties: Option<String>,

    /// Indicates whether this item is part of the linear reading order
    ///
    /// When `true`, this spine item is part of the main linear reading sequence.
    /// When `false`, this item represents supplementary content that may be accessed
    /// out of the normal reading order (e.g., through hyperlinks).
    ///
    /// Non-linear items are typically used for content like footnotes, endnotes,
    /// appendices, or other supplementary materials that readers might access
    /// on-demand rather than sequentially.
    pub linear: bool,
}

#[cfg(feature = "builder")]
impl SpineItem {
    /// Creates a new spine item referencing a manifest item
    ///
    /// Requires the `builder` feature.
    ///
    /// By default, spine items are linear.
    ///
    /// ## Parameters
    /// - `idref` - The ID of the manifest item this spine item references
    pub fn new(idref: &str) -> Self {
        Self {
            idref: idref.to_string(),
            id: None,
            properties: None,
            linear: true,
        }
    }

    /// Sets the ID of the spine item
    ///
    /// Requires the `builder` feature.
    ///
    /// ## Parameters
    /// - `id` - The ID to assign to this spine item
    pub fn with_id(&mut self, id: &str) -> &mut Self {
        self.id = Some(id.to_string());
        self
    }

    /// Appends a property to the spine item
    ///
    /// Requires the `builder` feature.
    ///
    /// ## Parameters
    /// - `property` - The property to add
    pub fn append_property(&mut self, property: &str) -> &mut Self {
        let new_properties = if let Some(properties) = &self.properties {
            format!("{} {}", properties, property)
        } else {
            property.to_string()
        };

        self.properties = Some(new_properties);
        self
    }

    /// Sets whether this spine item is part of the linear reading order
    ///
    /// Requires the `builder` feature.
    ///
    /// ## Parameters
    /// - `linear` - `true` if the item is part of the linear reading order, `false` otherwise
    pub fn set_linear(&mut self, linear: bool) -> &mut Self {
        self.linear = linear;
        self
    }

    /// Builds the final spine item
    ///
    /// Requires the `builder` feature.
    pub fn build(&self) -> Self {
        Self { ..self.clone() }
    }

    /// Gets the XML attributes for this spine item
    pub(crate) fn attributes(&self) -> Vec<(&str, &str)> {
        let mut attributes = Vec::new();

        attributes.push(("idref", self.idref.as_str()));
        attributes.push(("linear", if self.linear { "yes" } else { "no" }));

        if let Some(id) = &self.id {
            attributes.push(("id", id.as_str()));
        }

        if let Some(properties) = &self.properties {
            attributes.push(("properties", properties.as_str()));
        }

        attributes
    }
}

/// Represents encryption information for EPUB resources
///
/// This structure holds information about encrypted resources in an EPUB publication,
/// as defined in the META-INF/encryption.xml file according to the EPUB specification.
/// It describes which resources are encrypted and what encryption method was used.
#[derive(Debug, Clone)]
pub struct EncryptionData {
    /// The encryption algorithm URI
    ///
    /// This field specifies the encryption method used for the resource.
    /// Supported encryption methods:
    /// - IDPF font obfuscation: <http://www.idpf.org/2008/embedding>
    /// - Adobe font obfuscation: <http://ns.adobe.com/pdf/enc#RC>
    pub method: String,

    /// The URI of the encrypted resource
    ///
    /// This field contains the path/URI to the encrypted resource within the EPUB container.
    /// The path is relative to the root of the EPUB container.
    pub data: String,
}

/// Represents a navigation point in an EPUB document's table of contents
///
/// The `NavPoint` structure represents a single entry in the hierarchical table of contents
/// of an EPUB publication. Each navigation point corresponds to a section or chapter in
/// the publication and may contain nested child navigation points to represent sub-sections.
///
/// ## Builder Methods
///
/// When the `builder` feature is enabled, this struct provides convenient builder methods:
///
/// ```
/// # #[cfg(feature = "builder")] {
/// use lib_epub::types::NavPoint;
///
/// let nav_point = NavPoint::new("Chapter 1")
///     .with_content("chapter1.xhtml")
///     .append_child(
///         NavPoint::new("Section 1.1")
///             .with_content("section1_1.xhtml")
///             .build()
///     )
///     .build();
/// # }
/// ```
#[derive(Debug, Eq, Clone)]
pub struct NavPoint {
    /// The display label/title of this navigation point
    ///
    /// This is the text that should be displayed to users in the table of contents.
    pub label: String,

    /// The content document path this navigation point references
    ///
    /// Can be `None` for navigation points that no relevant information was
    /// provided in the original data.
    pub content: Option<PathBuf>,

    /// Child navigation points (sub-sections)
    pub children: Vec<NavPoint>,

    /// The reading order position of this navigation point
    ///
    /// It can be `None` for navigation points that no relevant information was
    /// provided in the original data.
    pub play_order: Option<usize>,
}

#[cfg(feature = "builder")]
impl NavPoint {
    /// Creates a new navigation point with the given label
    ///
    /// Requires the `builder` feature.
    ///
    /// ## Parameters
    /// - `label` - The display label for this navigation point
    pub fn new(label: &str) -> Self {
        Self {
            label: label.to_string(),
            content: None,
            children: vec![],
            play_order: None,
        }
    }

    /// Sets the content path for this navigation point
    ///
    /// Requires the `builder` feature.
    ///
    /// ## Parameters
    /// - `content` - The path to the content document
    pub fn with_content(&mut self, content: &str) -> &mut Self {
        self.content = Some(PathBuf::from(content));
        self
    }

    /// Appends a child navigation point
    ///
    /// Requires the `builder` feature.
    ///
    /// ## Parameters
    /// - `child` - The child navigation point to add
    pub fn append_child(&mut self, child: NavPoint) -> &mut Self {
        self.children.push(child);
        self
    }

    /// Sets all child navigation points
    ///
    /// Requires the `builder` feature.
    ///
    /// ## Parameters
    /// - `children` - Vector of child navigation points
    pub fn set_children(&mut self, children: Vec<NavPoint>) -> &mut Self {
        self.children = children;
        self
    }

    /// Builds the final navigation point
    ///
    /// Requires the `builder` feature.
    pub fn build(&self) -> Self {
        Self { ..self.clone() }
    }
}

impl Ord for NavPoint {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.play_order.cmp(&other.play_order)
    }
}

impl PartialOrd for NavPoint {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl PartialEq for NavPoint {
    fn eq(&self, other: &Self) -> bool {
        self.play_order == other.play_order
    }
}

/// Represents a footnote in an EPUB content document
///
/// This structure represents a footnote in an EPUB content document.
/// It contains the location within the content document and the content of the footnote.
#[cfg(feature = "content-builder")]
#[derive(Debug, Clone, Eq, PartialEq)]
pub struct Footnote {
    /// The position/location of the footnote reference in the content
    pub locate: usize,

    /// The text content of the footnote
    pub content: String,
}

#[cfg(feature = "content-builder")]
impl Ord for Footnote {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.locate.cmp(&other.locate)
    }
}

#[cfg(feature = "content-builder")]
impl PartialOrd for Footnote {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

/// Represents the type of a block element in the content document
#[cfg(feature = "content-builder")]
#[derive(Debug, Copy, Clone)]
pub enum BlockType {
    /// A text paragraph block
    ///
    /// Standard paragraph content with text styling applied.
    Text,

    /// A quotation block
    ///
    /// Represents quoted or indented text content, typically rendered
    /// with visual distinction from regular paragraphs.
    Quote,

    /// A title or heading block
    ///
    /// Represents chapter or section titles with appropriate heading styling.
    Title,

    /// An image block
    ///
    /// Contains embedded image content with optional caption support.
    Image,

    /// An audio block
    ///
    /// Contains audio content for playback within the document.
    Audio,

    /// A video block
    ///
    /// Contains video content for playback within the document.
    Video,

    /// A MathML block
    ///
    /// Contains mathematical notation using MathML markup for
    /// proper mathematical typesetting.
    MathML,
}

#[cfg(feature = "content-builder")]
impl std::fmt::Display for BlockType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BlockType::Text => write!(f, "Text"),
            BlockType::Quote => write!(f, "Quote"),
            BlockType::Title => write!(f, "Title"),
            BlockType::Image => write!(f, "Image"),
            BlockType::Audio => write!(f, "Audio"),
            BlockType::Video => write!(f, "Video"),
            BlockType::MathML => write!(f, "MathML"),
        }
    }
}

/// Configuration options for document styling
///
/// This struct aggregates all style-related configuration for an EPUB document,
/// including text appearance, color scheme, and page layout settings.
#[cfg(feature = "content-builder")]
#[derive(Debug, Default, Clone)]
pub struct StyleOptions {
    /// Text styling configuration
    pub text: TextStyle,

    /// Color scheme configuration
    ///
    /// Defines the background, text, and link colors for the document.
    pub color_scheme: ColorScheme,

    /// Page layout configuration
    ///
    /// Controls margins, text alignment, and paragraph spacing.
    pub layout: PageLayout,
}

#[cfg(feature = "content-builder")]
impl StyleOptions {
    /// Creates a new style options with default values
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the text style configuration
    pub fn with_text(&mut self, text: TextStyle) -> &mut Self {
        self.text = text;
        self
    }

    /// Sets the color scheme configuration
    pub fn with_color_scheme(&mut self, color_scheme: ColorScheme) -> &mut Self {
        self.color_scheme = color_scheme;
        self
    }

    /// Sets the page layout configuration
    pub fn with_layout(&mut self, layout: PageLayout) -> &mut Self {
        self.layout = layout;
        self
    }

    /// Builds the final style options
    pub fn build(&self) -> Self {
        Self { ..self.clone() }
    }
}

/// Text styling configuration
///
/// Defines the visual appearance of text content in the document,
/// including font properties, sizing, and spacing.
#[cfg(feature = "content-builder")]
#[derive(Debug, Clone)]
pub struct TextStyle {
    /// The base font size (default: 1.0, unit: rem)
    ///
    /// Relative to the root element, providing consistent sizing
    /// across different viewing contexts.
    pub font_size: f32,

    /// The line height (default: 1.6, unit: em)
    ///
    /// Controls the vertical spacing between lines of text.
    /// Values greater than 1.0 increase spacing, while values
    /// less than 1.0 compress the text.
    pub line_height: f32,

    /// The font family stack (default: "-apple-system, Roboto, sans-serif")
    ///
    /// A comma-separated list of font families to use, with
    /// fallback fonts specified for compatibility.
    pub font_family: String,

    /// The font weight (default: "normal")
    ///
    /// Controls the thickness of the font strokes. Common values
    /// include "normal" and "bold".
    pub font_weight: String,

    /// The font style (default: "normal")
    ///
    /// Controls whether the font is normal, italic, or oblique.
    /// Common values include "normal" and "italic".
    pub font_style: String,

    /// The letter spacing (default: "normal")
    ///
    /// Controls the space between characters. Common values
    /// include "normal" or specific lengths like "0.05em".
    pub letter_spacing: String,

    /// The text indent for paragraphs (default: 2.0, unit: em)
    ///
    /// Controls the indentation of the first line of paragraphs.
    /// A value of 2.0 means the first line is indented by 2 ems.
    pub text_indent: f32,
}

#[cfg(feature = "content-builder")]
impl Default for TextStyle {
    fn default() -> Self {
        Self {
            font_size: 1.0,
            line_height: 1.6,
            font_family: "-apple-system, Roboto, sans-serif".to_string(),
            font_weight: "normal".to_string(),
            font_style: "normal".to_string(),
            letter_spacing: "normal".to_string(),
            text_indent: 2.0,
        }
    }
}

#[cfg(feature = "content-builder")]
impl TextStyle {
    /// Creates a new text style with default values
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the font size
    pub fn with_font_size(&mut self, font_size: f32) -> &mut Self {
        self.font_size = font_size;
        self
    }

    /// Sets the line height
    pub fn with_line_height(&mut self, line_height: f32) -> &mut Self {
        self.line_height = line_height;
        self
    }

    /// Sets the font family
    pub fn with_font_family(&mut self, font_family: &str) -> &mut Self {
        self.font_family = font_family.to_string();
        self
    }

    /// Sets the font weight
    pub fn with_font_weight(&mut self, font_weight: &str) -> &mut Self {
        self.font_weight = font_weight.to_string();
        self
    }

    /// Sets the font style
    pub fn with_font_style(&mut self, font_style: &str) -> &mut Self {
        self.font_style = font_style.to_string();
        self
    }

    /// Sets the letter spacing
    pub fn with_letter_spacing(&mut self, letter_spacing: &str) -> &mut Self {
        self.letter_spacing = letter_spacing.to_string();
        self
    }

    /// Sets the text indent
    pub fn with_text_indent(&mut self, text_indent: f32) -> &mut Self {
        self.text_indent = text_indent;
        self
    }

    /// Builds the final text style
    pub fn build(&self) -> Self {
        Self { ..self.clone() }
    }
}

/// Color scheme configuration
///
/// Defines the color palette for the document, including background,
/// text, and link colors.
#[cfg(feature = "content-builder")]
#[derive(Debug, Clone)]
pub struct ColorScheme {
    /// The background color (default: "#FFFFFF")
    ///
    /// The fill color for the document body. Specified as a hex color
    /// string (e.g., "#FFFFFF" for white).
    pub background: String,

    /// The text color (default: "#000000")
    ///
    /// The primary color for text content. Specified as a hex color
    /// string (e.g., "#000000" for black).
    pub text: String,

    /// The link color (default: "#6f6f6f")
    ///
    /// The color for hyperlinks in the document. Specified as a hex
    /// color string (e.g., "#6f6f6f" for gray).
    pub link: String,
}

#[cfg(feature = "content-builder")]
impl Default for ColorScheme {
    fn default() -> Self {
        Self {
            background: "#FFFFFF".to_string(),
            text: "#000000".to_string(),
            link: "#6f6f6f".to_string(),
        }
    }
}

#[cfg(feature = "content-builder")]
impl ColorScheme {
    /// Creates a new color scheme with default values
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the background color
    pub fn with_background(&mut self, background: &str) -> &mut Self {
        self.background = background.to_string();
        self
    }

    /// Sets the text color
    pub fn with_text(&mut self, text: &str) -> &mut Self {
        self.text = text.to_string();
        self
    }

    /// Sets the link color
    pub fn with_link(&mut self, link: &str) -> &mut Self {
        self.link = link.to_string();
        self
    }

    /// Builds the final color scheme
    pub fn build(&self) -> Self {
        Self { ..self.clone() }
    }
}

/// Page layout configuration
///
/// Defines the layout properties for pages in the document, including
/// margins, text alignment, and paragraph spacing.
#[cfg(feature = "content-builder")]
#[derive(Debug, Clone)]
pub struct PageLayout {
    /// The page margin (default: 20, unit: pixels)
    ///
    /// Controls the space around the content area on each page.
    pub margin: usize,

    /// The text alignment mode (default: TextAlign::Left)
    ///
    /// Controls how text is aligned within the content area.
    pub text_align: TextAlign,

    /// The spacing between paragraphs (default: 16, unit: pixels)
    ///
    /// Controls the vertical space between block-level elements.
    pub paragraph_spacing: usize,
}

#[cfg(feature = "content-builder")]
impl Default for PageLayout {
    fn default() -> Self {
        Self {
            margin: 20,
            text_align: Default::default(),
            paragraph_spacing: 16,
        }
    }
}

#[cfg(feature = "content-builder")]
impl PageLayout {
    /// Creates a new page layout with default values
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the page margin
    pub fn with_margin(&mut self, margin: usize) -> &mut Self {
        self.margin = margin;
        self
    }

    /// Sets the text alignment
    pub fn with_text_align(&mut self, text_align: TextAlign) -> &mut Self {
        self.text_align = text_align;
        self
    }

    /// Sets the paragraph spacing
    pub fn with_paragraph_spacing(&mut self, paragraph_spacing: usize) -> &mut Self {
        self.paragraph_spacing = paragraph_spacing;
        self
    }

    /// Builds the final page layout
    pub fn build(&self) -> Self {
        Self { ..self.clone() }
    }
}

/// Text alignment options
///
/// Defines the available text alignment modes for content in the document.
#[cfg(feature = "content-builder")]
#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub enum TextAlign {
    /// Left-aligned text
    ///
    /// Text is aligned to the left margin, with the right edge ragged.
    #[default]
    Left,

    /// Right-aligned text
    ///
    /// Text is aligned to the right margin, with the left edge ragged.
    Right,

    /// Justified text
    ///
    /// Text is aligned to both margins by adjusting the spacing between
    /// words. The left and right edges are both straight.
    Justify,

    /// Centered text
    ///
    /// Text is centered within the content area, with both edges ragged.
    Center,
}

#[cfg(feature = "content-builder")]
impl std::fmt::Display for TextAlign {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TextAlign::Left => write!(f, "left"),
            TextAlign::Right => write!(f, "right"),
            TextAlign::Justify => write!(f, "justify"),
            TextAlign::Center => write!(f, "center"),
        }
    }
}

#[cfg(test)]
mod tests {
    mod navpoint_tests {
        use std::path::PathBuf;

        use crate::types::NavPoint;

        /// Testing the equality comparison of NavPoint
        #[test]
        fn test_navpoint_partial_eq() {
            let nav1 = NavPoint {
                label: "Chapter 1".to_string(),
                content: Some(PathBuf::from("chapter1.html")),
                children: vec![],
                play_order: Some(1),
            };

            let nav2 = NavPoint {
                label: "Chapter 1".to_string(),
                content: Some(PathBuf::from("chapter2.html")),
                children: vec![],
                play_order: Some(1),
            };

            let nav3 = NavPoint {
                label: "Chapter 2".to_string(),
                content: Some(PathBuf::from("chapter1.html")),
                children: vec![],
                play_order: Some(2),
            };

            assert_eq!(nav1, nav2); // Same play_order, different contents, should be equal
            assert_ne!(nav1, nav3); // Different play_order, Same contents, should be unequal
        }

        /// Test NavPoint sorting comparison
        #[test]
        fn test_navpoint_ord() {
            let nav1 = NavPoint {
                label: "Chapter 1".to_string(),
                content: Some(PathBuf::from("chapter1.html")),
                children: vec![],
                play_order: Some(1),
            };

            let nav2 = NavPoint {
                label: "Chapter 2".to_string(),
                content: Some(PathBuf::from("chapter2.html")),
                children: vec![],
                play_order: Some(2),
            };

            let nav3 = NavPoint {
                label: "Chapter 3".to_string(),
                content: Some(PathBuf::from("chapter3.html")),
                children: vec![],
                play_order: Some(3),
            };

            // Test function cmp
            assert!(nav1 < nav2);
            assert!(nav2 > nav1);
            assert!(nav1 == nav1);

            // Test function partial_cmp
            assert_eq!(nav1.partial_cmp(&nav2), Some(std::cmp::Ordering::Less));
            assert_eq!(nav2.partial_cmp(&nav1), Some(std::cmp::Ordering::Greater));
            assert_eq!(nav1.partial_cmp(&nav1), Some(std::cmp::Ordering::Equal));

            // Test function sort
            let mut nav_points = vec![nav2.clone(), nav3.clone(), nav1.clone()];
            nav_points.sort();
            assert_eq!(nav_points, vec![nav1, nav2, nav3]);
        }

        /// Test the case of None play_order
        #[test]
        fn test_navpoint_ord_with_none_play_order() {
            let nav_with_order = NavPoint {
                label: "Chapter 1".to_string(),
                content: Some(PathBuf::from("chapter1.html")),
                children: vec![],
                play_order: Some(1),
            };

            let nav_without_order = NavPoint {
                label: "Preface".to_string(),
                content: Some(PathBuf::from("preface.html")),
                children: vec![],
                play_order: None,
            };

            assert!(nav_without_order < nav_with_order);
            assert!(nav_with_order > nav_without_order);

            let nav_without_order2 = NavPoint {
                label: "Introduction".to_string(),
                content: Some(PathBuf::from("intro.html")),
                children: vec![],
                play_order: None,
            };

            assert!(nav_without_order == nav_without_order2);
        }

        /// Test NavPoint containing child nodes
        #[test]
        fn test_navpoint_with_children() {
            let child1 = NavPoint {
                label: "Section 1.1".to_string(),
                content: Some(PathBuf::from("section1_1.html")),
                children: vec![],
                play_order: Some(1),
            };

            let child2 = NavPoint {
                label: "Section 1.2".to_string(),
                content: Some(PathBuf::from("section1_2.html")),
                children: vec![],
                play_order: Some(2),
            };

            let parent1 = NavPoint {
                label: "Chapter 1".to_string(),
                content: Some(PathBuf::from("chapter1.html")),
                children: vec![child1.clone(), child2.clone()],
                play_order: Some(1),
            };

            let parent2 = NavPoint {
                label: "Chapter 1".to_string(),
                content: Some(PathBuf::from("chapter1.html")),
                children: vec![child1.clone(), child2.clone()],
                play_order: Some(1),
            };

            assert!(parent1 == parent2);

            let parent3 = NavPoint {
                label: "Chapter 2".to_string(),
                content: Some(PathBuf::from("chapter2.html")),
                children: vec![child1.clone(), child2.clone()],
                play_order: Some(2),
            };

            assert!(parent1 != parent3);
            assert!(parent1 < parent3);
        }

        /// Test the case where content is None
        #[test]
        fn test_navpoint_with_none_content() {
            let nav1 = NavPoint {
                label: "Chapter 1".to_string(),
                content: None,
                children: vec![],
                play_order: Some(1),
            };

            let nav2 = NavPoint {
                label: "Chapter 1".to_string(),
                content: None,
                children: vec![],
                play_order: Some(1),
            };

            assert!(nav1 == nav2);
        }
    }

    #[cfg(feature = "builder")]
    mod builder_tests {
        mod metadata_item {
            use crate::types::{MetadataItem, MetadataRefinement};

            #[test]
            fn test_metadata_item_new() {
                let metadata_item = MetadataItem::new("title", "EPUB Test Book");

                assert_eq!(metadata_item.property, "title");
                assert_eq!(metadata_item.value, "EPUB Test Book");
                assert_eq!(metadata_item.id, None);
                assert_eq!(metadata_item.lang, None);
                assert_eq!(metadata_item.refined.len(), 0);
            }

            #[test]
            fn test_metadata_item_with_id() {
                let mut metadata_item = MetadataItem::new("creator", "John Doe");
                metadata_item.with_id("creator-1");

                assert_eq!(metadata_item.property, "creator");
                assert_eq!(metadata_item.value, "John Doe");
                assert_eq!(metadata_item.id, Some("creator-1".to_string()));
                assert_eq!(metadata_item.lang, None);
                assert_eq!(metadata_item.refined.len(), 0);
            }

            #[test]
            fn test_metadata_item_with_lang() {
                let mut metadata_item = MetadataItem::new("title", "测试书籍");
                metadata_item.with_lang("zh-CN");

                assert_eq!(metadata_item.property, "title");
                assert_eq!(metadata_item.value, "测试书籍");
                assert_eq!(metadata_item.id, None);
                assert_eq!(metadata_item.lang, Some("zh-CN".to_string()));
                assert_eq!(metadata_item.refined.len(), 0);
            }

            #[test]
            fn test_metadata_item_append_refinement() {
                let mut metadata_item = MetadataItem::new("creator", "John Doe");
                metadata_item.with_id("creator-1"); // ID is required for refinements

                let refinement = MetadataRefinement::new("creator-1", "role", "author");
                metadata_item.append_refinement(refinement);

                assert_eq!(metadata_item.refined.len(), 1);
                assert_eq!(metadata_item.refined[0].refines, "creator-1");
                assert_eq!(metadata_item.refined[0].property, "role");
                assert_eq!(metadata_item.refined[0].value, "author");
            }

            #[test]
            fn test_metadata_item_append_refinement_without_id() {
                let mut metadata_item = MetadataItem::new("title", "Test Book");
                // No ID set

                let refinement = MetadataRefinement::new("title", "title-type", "main");
                metadata_item.append_refinement(refinement);

                // Refinement should not be added because metadata item has no ID
                assert_eq!(metadata_item.refined.len(), 0);
            }

            #[test]
            fn test_metadata_item_build() {
                let mut metadata_item = MetadataItem::new("identifier", "urn:isbn:1234567890");
                metadata_item.with_id("pub-id").with_lang("en");

                let built = metadata_item.build();

                assert_eq!(built.property, "identifier");
                assert_eq!(built.value, "urn:isbn:1234567890");
                assert_eq!(built.id, Some("pub-id".to_string()));
                assert_eq!(built.lang, Some("en".to_string()));
                assert_eq!(built.refined.len(), 0);
            }

            #[test]
            fn test_metadata_item_builder_chaining() {
                let mut metadata_item = MetadataItem::new("title", "EPUB 3.3 Guide");
                metadata_item.with_id("title").with_lang("en");

                let refinement = MetadataRefinement::new("title", "title-type", "main");
                metadata_item.append_refinement(refinement);

                let built = metadata_item.build();

                assert_eq!(built.property, "title");
                assert_eq!(built.value, "EPUB 3.3 Guide");
                assert_eq!(built.id, Some("title".to_string()));
                assert_eq!(built.lang, Some("en".to_string()));
                assert_eq!(built.refined.len(), 1);
            }

            #[test]
            fn test_metadata_item_attributes_dc_namespace() {
                let mut metadata_item = MetadataItem::new("title", "Test Book");
                metadata_item.with_id("title-id");

                let attributes = metadata_item.attributes();

                // For DC namespace properties, no "property" attribute should be added
                assert!(!attributes.iter().any(|(k, _)| k == &"property"));
                assert!(
                    attributes
                        .iter()
                        .any(|(k, v)| k == &"id" && v == &"title-id")
                );
            }

            #[test]
            fn test_metadata_item_attributes_non_dc_namespace() {
                let mut metadata_item = MetadataItem::new("meta", "value");
                metadata_item.with_id("meta-id");

                let attributes = metadata_item.attributes();

                // For non-DC namespace properties, "property" attribute should be added
                assert!(attributes.iter().any(|(k, _)| k == &"property"));
                assert!(
                    attributes
                        .iter()
                        .any(|(k, v)| k == &"id" && v == &"meta-id")
                );
            }

            #[test]
            fn test_metadata_item_attributes_with_lang() {
                let mut metadata_item = MetadataItem::new("title", "Test Book");
                metadata_item.with_id("title-id").with_lang("en");

                let attributes = metadata_item.attributes();

                assert!(
                    attributes
                        .iter()
                        .any(|(k, v)| k == &"id" && v == &"title-id")
                );
                assert!(attributes.iter().any(|(k, v)| k == &"lang" && v == &"en"));
            }
        }

        mod metadata_refinement {
            use crate::types::MetadataRefinement;

            #[test]
            fn test_metadata_refinement_new() {
                let refinement = MetadataRefinement::new("title", "title-type", "main");

                assert_eq!(refinement.refines, "title");
                assert_eq!(refinement.property, "title-type");
                assert_eq!(refinement.value, "main");
                assert_eq!(refinement.lang, None);
                assert_eq!(refinement.scheme, None);
            }

            #[test]
            fn test_metadata_refinement_with_lang() {
                let mut refinement = MetadataRefinement::new("creator", "role", "author");
                refinement.with_lang("en");

                assert_eq!(refinement.refines, "creator");
                assert_eq!(refinement.property, "role");
                assert_eq!(refinement.value, "author");
                assert_eq!(refinement.lang, Some("en".to_string()));
                assert_eq!(refinement.scheme, None);
            }

            #[test]
            fn test_metadata_refinement_with_scheme() {
                let mut refinement = MetadataRefinement::new("creator", "role", "author");
                refinement.with_scheme("marc:relators");

                assert_eq!(refinement.refines, "creator");
                assert_eq!(refinement.property, "role");
                assert_eq!(refinement.value, "author");
                assert_eq!(refinement.lang, None);
                assert_eq!(refinement.scheme, Some("marc:relators".to_string()));
            }

            #[test]
            fn test_metadata_refinement_build() {
                let mut refinement = MetadataRefinement::new("title", "alternate-script", "テスト");
                refinement.with_lang("ja").with_scheme("iso-15924");

                let built = refinement.build();

                assert_eq!(built.refines, "title");
                assert_eq!(built.property, "alternate-script");
                assert_eq!(built.value, "テスト");
                assert_eq!(built.lang, Some("ja".to_string()));
                assert_eq!(built.scheme, Some("iso-15924".to_string()));
            }

            #[test]
            fn test_metadata_refinement_builder_chaining() {
                let mut refinement = MetadataRefinement::new("creator", "file-as", "Doe, John");
                refinement.with_lang("en").with_scheme("dcterms");

                let built = refinement.build();

                assert_eq!(built.refines, "creator");
                assert_eq!(built.property, "file-as");
                assert_eq!(built.value, "Doe, John");
                assert_eq!(built.lang, Some("en".to_string()));
                assert_eq!(built.scheme, Some("dcterms".to_string()));
            }

            #[test]
            fn test_metadata_refinement_attributes() {
                let mut refinement = MetadataRefinement::new("title", "title-type", "main");
                refinement.with_lang("en").with_scheme("onix:codelist5");

                let attributes = refinement.attributes();

                assert!(
                    attributes
                        .iter()
                        .any(|(k, v)| k == &"refines" && v == &"title")
                );
                assert!(
                    attributes
                        .iter()
                        .any(|(k, v)| k == &"property" && v == &"title-type")
                );
                assert!(attributes.iter().any(|(k, v)| k == &"lang" && v == &"en"));
                assert!(
                    attributes
                        .iter()
                        .any(|(k, v)| k == &"scheme" && v == &"onix:codelist5")
                );
            }

            #[test]
            fn test_metadata_refinement_attributes_optional_fields() {
                let refinement = MetadataRefinement::new("creator", "role", "author");
                let attributes = refinement.attributes();

                assert!(
                    attributes
                        .iter()
                        .any(|(k, v)| k == &"refines" && v == &"creator")
                );
                assert!(
                    attributes
                        .iter()
                        .any(|(k, v)| k == &"property" && v == &"role")
                );

                // Should not contain optional attributes when they are None
                assert!(!attributes.iter().any(|(k, _)| k == &"lang"));
                assert!(!attributes.iter().any(|(k, _)| k == &"scheme"));
            }
        }

        mod manifest_item {
            use std::path::PathBuf;

            use crate::types::ManifestItem;

            #[test]
            fn test_manifest_item_new() {
                let manifest_item = ManifestItem::new("cover", "images/cover.jpg");
                assert!(manifest_item.is_ok());

                let manifest_item = manifest_item.unwrap();
                assert_eq!(manifest_item.id, "cover");
                assert_eq!(manifest_item.path, PathBuf::from("images/cover.jpg"));
                assert_eq!(manifest_item.mime, "");
                assert_eq!(manifest_item.properties, None);
                assert_eq!(manifest_item.fallback, None);
            }

            #[test]
            fn test_manifest_item_append_property() {
                let manifest_item = ManifestItem::new("nav", "nav.xhtml");
                assert!(manifest_item.is_ok());

                let mut manifest_item = manifest_item.unwrap();
                manifest_item.append_property("nav");

                assert_eq!(manifest_item.id, "nav");
                assert_eq!(manifest_item.path, PathBuf::from("nav.xhtml"));
                assert_eq!(manifest_item.mime, "");
                assert_eq!(manifest_item.properties, Some("nav".to_string()));
                assert_eq!(manifest_item.fallback, None);
            }

            #[test]
            fn test_manifest_item_append_multiple_properties() {
                let manifest_item = ManifestItem::new("content", "content.xhtml");
                assert!(manifest_item.is_ok());

                let mut manifest_item = manifest_item.unwrap();
                manifest_item
                    .append_property("nav")
                    .append_property("scripted")
                    .append_property("svg");

                assert_eq!(
                    manifest_item.properties,
                    Some("nav scripted svg".to_string())
                );
            }

            #[test]
            fn test_manifest_item_with_fallback() {
                let manifest_item = ManifestItem::new("image", "image.tiff");
                assert!(manifest_item.is_ok());

                let mut manifest_item = manifest_item.unwrap();
                manifest_item.with_fallback("image-fallback");

                assert_eq!(manifest_item.id, "image");
                assert_eq!(manifest_item.path, PathBuf::from("image.tiff"));
                assert_eq!(manifest_item.mime, "");
                assert_eq!(manifest_item.properties, None);
                assert_eq!(manifest_item.fallback, Some("image-fallback".to_string()));
            }

            #[test]
            fn test_manifest_item_set_mime() {
                let manifest_item = ManifestItem::new("style", "style.css");
                assert!(manifest_item.is_ok());

                let manifest_item = manifest_item.unwrap();
                let updated_item = manifest_item.set_mime("text/css");

                assert_eq!(updated_item.id, "style");
                assert_eq!(updated_item.path, PathBuf::from("style.css"));
                assert_eq!(updated_item.mime, "text/css");
                assert_eq!(updated_item.properties, None);
                assert_eq!(updated_item.fallback, None);
            }

            #[test]
            fn test_manifest_item_build() {
                let manifest_item = ManifestItem::new("cover", "images/cover.jpg");
                assert!(manifest_item.is_ok());

                let mut manifest_item = manifest_item.unwrap();
                manifest_item
                    .append_property("cover-image")
                    .with_fallback("cover-fallback");

                let built = manifest_item.build();

                assert_eq!(built.id, "cover");
                assert_eq!(built.path, PathBuf::from("images/cover.jpg"));
                assert_eq!(built.mime, "");
                assert_eq!(built.properties, Some("cover-image".to_string()));
                assert_eq!(built.fallback, Some("cover-fallback".to_string()));
            }

            #[test]
            fn test_manifest_item_builder_chaining() {
                let manifest_item = ManifestItem::new("content", "content.xhtml");
                assert!(manifest_item.is_ok());

                let mut manifest_item = manifest_item.unwrap();
                manifest_item
                    .append_property("scripted")
                    .append_property("svg")
                    .with_fallback("fallback-content");

                let built = manifest_item.build();

                assert_eq!(built.id, "content");
                assert_eq!(built.path, PathBuf::from("content.xhtml"));
                assert_eq!(built.mime, "");
                assert_eq!(built.properties, Some("scripted svg".to_string()));
                assert_eq!(built.fallback, Some("fallback-content".to_string()));
            }

            #[test]
            fn test_manifest_item_attributes() {
                let manifest_item = ManifestItem::new("nav", "nav.xhtml");
                assert!(manifest_item.is_ok());

                let mut manifest_item = manifest_item.unwrap();
                manifest_item
                    .append_property("nav")
                    .with_fallback("fallback-nav");

                // Manually set mime type for testing
                let manifest_item = manifest_item.set_mime("application/xhtml+xml");
                let attributes = manifest_item.attributes();

                // Check that all expected attributes are present
                assert!(attributes.contains(&("id", "nav")));
                assert!(attributes.contains(&("href", "nav.xhtml")));
                assert!(attributes.contains(&("media-type", "application/xhtml+xml")));
                assert!(attributes.contains(&("properties", "nav")));
                assert!(attributes.contains(&("fallback", "fallback-nav")));
            }

            #[test]
            fn test_manifest_item_attributes_optional_fields() {
                let manifest_item = ManifestItem::new("simple", "simple.xhtml");
                assert!(manifest_item.is_ok());

                let manifest_item = manifest_item.unwrap();
                let manifest_item = manifest_item.set_mime("application/xhtml+xml");
                let attributes = manifest_item.attributes();

                // Should contain required attributes
                assert!(attributes.contains(&("id", "simple")));
                assert!(attributes.contains(&("href", "simple.xhtml")));
                assert!(attributes.contains(&("media-type", "application/xhtml+xml")));

                // Should not contain optional attributes when they are None
                assert!(!attributes.iter().any(|(k, _)| k == &"properties"));
                assert!(!attributes.iter().any(|(k, _)| k == &"fallback"));
            }

            #[test]
            fn test_manifest_item_path_handling() {
                let manifest_item = ManifestItem::new("test", "../images/test.png");
                assert!(manifest_item.is_err());

                let err = manifest_item.unwrap_err();
                assert_eq!(
                    err.to_string(),
                    "Epub builder error: A manifest with id 'test' should not use a relative path starting with '../'."
                );
            }
        }

        mod spine_item {
            use crate::types::SpineItem;

            #[test]
            fn test_spine_item_new() {
                let spine_item = SpineItem::new("content_001");

                assert_eq!(spine_item.idref, "content_001");
                assert_eq!(spine_item.id, None);
                assert_eq!(spine_item.properties, None);
                assert_eq!(spine_item.linear, true);
            }

            #[test]
            fn test_spine_item_with_id() {
                let mut spine_item = SpineItem::new("content_001");
                spine_item.with_id("spine1");

                assert_eq!(spine_item.idref, "content_001");
                assert_eq!(spine_item.id, Some("spine1".to_string()));
                assert_eq!(spine_item.properties, None);
                assert_eq!(spine_item.linear, true);
            }

            #[test]
            fn test_spine_item_append_property() {
                let mut spine_item = SpineItem::new("content_001");
                spine_item.append_property("page-spread-left");

                assert_eq!(spine_item.idref, "content_001");
                assert_eq!(spine_item.id, None);
                assert_eq!(spine_item.properties, Some("page-spread-left".to_string()));
                assert_eq!(spine_item.linear, true);
            }

            #[test]
            fn test_spine_item_append_multiple_properties() {
                let mut spine_item = SpineItem::new("content_001");
                spine_item
                    .append_property("page-spread-left")
                    .append_property("rendition:layout-pre-paginated");

                assert_eq!(
                    spine_item.properties,
                    Some("page-spread-left rendition:layout-pre-paginated".to_string())
                );
            }

            #[test]
            fn test_spine_item_set_linear() {
                let mut spine_item = SpineItem::new("content_001");
                spine_item.set_linear(false);

                assert_eq!(spine_item.idref, "content_001");
                assert_eq!(spine_item.id, None);
                assert_eq!(spine_item.properties, None);
                assert_eq!(spine_item.linear, false);
            }

            #[test]
            fn test_spine_item_build() {
                let mut spine_item = SpineItem::new("content_001");
                spine_item
                    .with_id("spine1")
                    .append_property("page-spread-left")
                    .set_linear(false);

                let built = spine_item.build();

                assert_eq!(built.idref, "content_001");
                assert_eq!(built.id, Some("spine1".to_string()));
                assert_eq!(built.properties, Some("page-spread-left".to_string()));
                assert_eq!(built.linear, false);
            }

            #[test]
            fn test_spine_item_builder_chaining() {
                let mut spine_item = SpineItem::new("content_001");
                spine_item
                    .with_id("spine1")
                    .append_property("page-spread-left")
                    .set_linear(false);

                let built = spine_item.build();

                assert_eq!(built.idref, "content_001");
                assert_eq!(built.id, Some("spine1".to_string()));
                assert_eq!(built.properties, Some("page-spread-left".to_string()));
                assert_eq!(built.linear, false);
            }

            #[test]
            fn test_spine_item_attributes() {
                let mut spine_item = SpineItem::new("content_001");
                spine_item
                    .with_id("spine1")
                    .append_property("page-spread-left")
                    .set_linear(false);

                let attributes = spine_item.attributes();

                // Check that all expected attributes are present
                assert!(attributes.contains(&("idref", "content_001")));
                assert!(attributes.contains(&("id", "spine1")));
                assert!(attributes.contains(&("properties", "page-spread-left")));
                assert!(attributes.contains(&("linear", "no"))); // false should become "no"
            }

            #[test]
            fn test_spine_item_attributes_linear_yes() {
                let spine_item = SpineItem::new("content_001");
                let attributes = spine_item.attributes();

                // Linear true should become "yes"
                assert!(attributes.contains(&("linear", "yes")));
            }

            #[test]
            fn test_spine_item_attributes_optional_fields() {
                let spine_item = SpineItem::new("content_001");
                let attributes = spine_item.attributes();

                // Should only contain required attributes when optional fields are None
                assert!(attributes.contains(&("idref", "content_001")));
                assert!(attributes.contains(&("linear", "yes")));

                // Should not contain optional attributes when they are None
                assert!(!attributes.iter().any(|(k, _)| k == &"id"));
                assert!(!attributes.iter().any(|(k, _)| k == &"properties"));
            }
        }

        mod metadata_sheet {
            use crate::types::{MetadataItem, MetadataSheet};

            #[test]
            fn test_metadata_sheet_new() {
                let sheet = MetadataSheet::new();

                assert!(sheet.contributor.is_empty());
                assert!(sheet.creator.is_empty());
                assert!(sheet.date.is_empty());
                assert!(sheet.identifier.is_empty());
                assert!(sheet.language.is_empty());
                assert!(sheet.relation.is_empty());
                assert!(sheet.subject.is_empty());
                assert!(sheet.title.is_empty());

                assert!(sheet.coverage.is_empty());
                assert!(sheet.description.is_empty());
                assert!(sheet.format.is_empty());
                assert!(sheet.publisher.is_empty());
                assert!(sheet.rights.is_empty());
                assert!(sheet.source.is_empty());
                assert!(sheet.epub_type.is_empty());
            }

            #[test]
            fn test_metadata_sheet_append_vec_fields() {
                let mut sheet = MetadataSheet::new();

                sheet
                    .append_title("Test Book")
                    .append_creator("John Doe")
                    .append_creator("Jane Smith")
                    .append_contributor("Editor One")
                    .append_language("en")
                    .append_language("zh-CN")
                    .append_subject("Fiction")
                    .append_subject("Drama")
                    .append_relation("prequel");

                assert_eq!(sheet.title.len(), 1);
                assert_eq!(sheet.title[0], "Test Book");

                assert_eq!(sheet.creator.len(), 2);
                assert_eq!(sheet.creator[0], "John Doe");
                assert_eq!(sheet.creator[1], "Jane Smith");

                assert_eq!(sheet.contributor.len(), 1);
                assert_eq!(sheet.contributor[0], "Editor One");

                assert_eq!(sheet.language.len(), 2);
                assert_eq!(sheet.language[0], "en");
                assert_eq!(sheet.language[1], "zh-CN");

                assert_eq!(sheet.subject.len(), 2);
                assert_eq!(sheet.subject[0], "Fiction");
                assert_eq!(sheet.subject[1], "Drama");

                assert_eq!(sheet.relation.len(), 1);
                assert_eq!(sheet.relation[0], "prequel");
            }

            #[test]
            fn test_metadata_sheet_append_date_and_identifier() {
                let mut sheet = MetadataSheet::new();

                sheet
                    .append_date("2024-01-15", "publication")
                    .append_date("2024-01-10", "creation")
                    .append_identifier("book-id", "urn:isbn:1234567890")
                    .append_identifier("uuid-id", "urn:uuid:12345678-1234-1234-1234-123456789012");

                assert_eq!(sheet.date.len(), 2);
                assert_eq!(
                    sheet.date.get("2024-01-15"),
                    Some(&"publication".to_string())
                );
                assert_eq!(sheet.date.get("2024-01-10"), Some(&"creation".to_string()));

                assert_eq!(sheet.identifier.len(), 2);
                assert_eq!(
                    sheet.identifier.get("book-id"),
                    Some(&"urn:isbn:1234567890".to_string())
                );
                assert_eq!(
                    sheet.identifier.get("uuid-id"),
                    Some(&"urn:uuid:12345678-1234-1234-1234-123456789012".to_string())
                );
            }

            #[test]
            fn test_metadata_sheet_with_string_fields() {
                let mut sheet = MetadataSheet::new();

                sheet
                    .with_coverage("Spatial coverage")
                    .with_description("A test book description")
                    .with_format("application/epub+zip")
                    .with_publisher("Test Publisher")
                    .with_rights("Copyright 2024")
                    .with_source("Original source")
                    .with_epub_type("buku");

                assert_eq!(sheet.coverage, "Spatial coverage");
                assert_eq!(sheet.description, "A test book description");
                assert_eq!(sheet.format, "application/epub+zip");
                assert_eq!(sheet.publisher, "Test Publisher");
                assert_eq!(sheet.rights, "Copyright 2024");
                assert_eq!(sheet.source, "Original source");
                assert_eq!(sheet.epub_type, "buku");
            }

            #[test]
            fn test_metadata_sheet_builder_chaining() {
                let mut sheet = MetadataSheet::new();

                sheet
                    .append_title("Chained Book")
                    .append_creator("Chained Author")
                    .append_date("2024-01-01", "")
                    .append_identifier("id-1", "test-id")
                    .with_publisher("Chained Publisher")
                    .with_description("Chained description");

                assert_eq!(sheet.title.len(), 1);
                assert_eq!(sheet.title[0], "Chained Book");

                assert_eq!(sheet.creator.len(), 1);
                assert_eq!(sheet.creator[0], "Chained Author");

                assert_eq!(sheet.date.len(), 1);
                assert_eq!(sheet.identifier.len(), 1);
                assert_eq!(sheet.publisher, "Chained Publisher");
                assert_eq!(sheet.description, "Chained description");
            }

            #[test]
            fn test_metadata_sheet_build() {
                let mut sheet = MetadataSheet::new();
                sheet
                    .append_title("Original Title")
                    .with_publisher("Original Publisher");

                let built = sheet.build();

                assert_eq!(built.title.len(), 1);
                assert_eq!(built.title[0], "Original Title");
                assert_eq!(built.publisher, "Original Publisher");

                sheet.append_title("New Title");
                sheet.with_publisher("New Publisher");

                assert_eq!(sheet.title.len(), 2);
                assert_eq!(built.title.len(), 1);
                assert_eq!(built.publisher, "Original Publisher");
            }

            #[test]
            fn test_metadata_sheet_into_metadata_items() {
                let mut sheet = MetadataSheet::new();
                sheet
                    .append_title("Test Title")
                    .append_creator("Test Creator")
                    .with_description("Test Description")
                    .with_publisher("Test Publisher");

                let items: Vec<MetadataItem> = sheet.into();

                assert_eq!(items.len(), 4);

                assert!(
                    items
                        .iter()
                        .any(|i| i.property == "title" && i.value == "Test Title")
                );

                assert!(
                    items
                        .iter()
                        .any(|i| i.property == "creator" && i.value == "Test Creator")
                );

                assert!(
                    items
                        .iter()
                        .any(|i| i.property == "description" && i.value == "Test Description")
                );

                assert!(
                    items
                        .iter()
                        .any(|i| i.property == "publisher" && i.value == "Test Publisher")
                );
            }

            #[test]
            fn test_metadata_sheet_into_metadata_items_with_date_and_identifier() {
                let mut sheet = MetadataSheet::new();
                sheet
                    .append_date("2024-01-15", "publication")
                    .append_identifier("book-id", "urn:isbn:9876543210");

                let items: Vec<MetadataItem> = sheet.into();

                assert_eq!(items.len(), 2);

                let date_item = items.iter().find(|i| i.property == "date").unwrap();

                assert_eq!(date_item.value, "2024-01-15");
                assert!(date_item.id.is_some());
                assert_eq!(date_item.refined.len(), 1);
                assert_eq!(date_item.refined[0].property, "event");
                assert_eq!(date_item.refined[0].value, "publication");

                let id_item = items.iter().find(|i| i.property == "identifier").unwrap();

                assert_eq!(id_item.value, "urn:isbn:9876543210");
                assert_eq!(id_item.id, Some("book-id".to_string()));
            }

            #[test]
            fn test_metadata_sheet_into_metadata_items_ignores_empty_fields() {
                let mut sheet = MetadataSheet::new();
                sheet.append_title("Valid Title").with_description(""); // Empty string should be ignored

                let items: Vec<MetadataItem> = sheet.into();

                assert_eq!(items.len(), 1);
                assert_eq!(items[0].property, "title");
            }
        }

        mod navpoint {

            use std::path::PathBuf;

            use crate::types::NavPoint;

            #[test]
            fn test_navpoint_new() {
                let navpoint = NavPoint::new("Test Chapter");

                assert_eq!(navpoint.label, "Test Chapter");
                assert_eq!(navpoint.content, None);
                assert_eq!(navpoint.children.len(), 0);
            }

            #[test]
            fn test_navpoint_with_content() {
                let mut navpoint = NavPoint::new("Test Chapter");
                navpoint.with_content("chapter1.html");

                assert_eq!(navpoint.label, "Test Chapter");
                assert_eq!(navpoint.content, Some(PathBuf::from("chapter1.html")));
                assert_eq!(navpoint.children.len(), 0);
            }

            #[test]
            fn test_navpoint_append_child() {
                let mut parent = NavPoint::new("Parent Chapter");

                let mut child1 = NavPoint::new("Child Section 1");
                child1.with_content("section1.html");

                let mut child2 = NavPoint::new("Child Section 2");
                child2.with_content("section2.html");

                parent.append_child(child1.build());
                parent.append_child(child2.build());

                assert_eq!(parent.children.len(), 2);
                assert_eq!(parent.children[0].label, "Child Section 1");
                assert_eq!(parent.children[1].label, "Child Section 2");
            }

            #[test]
            fn test_navpoint_set_children() {
                let mut navpoint = NavPoint::new("Main Chapter");
                let children = vec![NavPoint::new("Section 1"), NavPoint::new("Section 2")];

                navpoint.set_children(children);

                assert_eq!(navpoint.children.len(), 2);
                assert_eq!(navpoint.children[0].label, "Section 1");
                assert_eq!(navpoint.children[1].label, "Section 2");
            }

            #[test]
            fn test_navpoint_build() {
                let mut navpoint = NavPoint::new("Complete Chapter");
                navpoint.with_content("complete.html");

                let child = NavPoint::new("Sub Section");
                navpoint.append_child(child.build());

                let built = navpoint.build();

                assert_eq!(built.label, "Complete Chapter");
                assert_eq!(built.content, Some(PathBuf::from("complete.html")));
                assert_eq!(built.children.len(), 1);
                assert_eq!(built.children[0].label, "Sub Section");
            }

            #[test]
            fn test_navpoint_builder_chaining() {
                let mut navpoint = NavPoint::new("Chained Chapter");

                navpoint
                    .with_content("chained.html")
                    .append_child(NavPoint::new("Child 1").build())
                    .append_child(NavPoint::new("Child 2").build());

                let built = navpoint.build();

                assert_eq!(built.label, "Chained Chapter");
                assert_eq!(built.content, Some(PathBuf::from("chained.html")));
                assert_eq!(built.children.len(), 2);
            }

            #[test]
            fn test_navpoint_empty_children() {
                let navpoint = NavPoint::new("No Children Chapter");
                let built = navpoint.build();

                assert_eq!(built.children.len(), 0);
            }

            #[test]
            fn test_navpoint_complex_hierarchy() {
                let mut root = NavPoint::new("Book");

                let mut chapter1 = NavPoint::new("Chapter 1");
                chapter1
                    .with_content("chapter1.html")
                    .append_child(
                        NavPoint::new("Section 1.1")
                            .with_content("sec1_1.html")
                            .build(),
                    )
                    .append_child(
                        NavPoint::new("Section 1.2")
                            .with_content("sec1_2.html")
                            .build(),
                    );

                let mut chapter2 = NavPoint::new("Chapter 2");
                chapter2.with_content("chapter2.html").append_child(
                    NavPoint::new("Section 2.1")
                        .with_content("sec2_1.html")
                        .build(),
                );

                root.append_child(chapter1.build())
                    .append_child(chapter2.build());

                let book = root.build();

                assert_eq!(book.label, "Book");
                assert_eq!(book.children.len(), 2);

                let ch1 = &book.children[0];
                assert_eq!(ch1.label, "Chapter 1");
                assert_eq!(ch1.children.len(), 2);

                let ch2 = &book.children[1];
                assert_eq!(ch2.label, "Chapter 2");
                assert_eq!(ch2.children.len(), 1);
            }
        }
    }

    #[cfg(feature = "content-builder")]
    mod footnote_tests {
        use crate::types::Footnote;

        #[test]
        fn test_footnote_basic_creation() {
            let footnote = Footnote {
                locate: 100,
                content: "Sample footnote".to_string(),
            };

            assert_eq!(footnote.locate, 100);
            assert_eq!(footnote.content, "Sample footnote");
        }

        #[test]
        fn test_footnote_equality() {
            let footnote1 = Footnote {
                locate: 100,
                content: "First note".to_string(),
            };

            let footnote2 = Footnote {
                locate: 100,
                content: "First note".to_string(),
            };

            let footnote3 = Footnote {
                locate: 100,
                content: "Different note".to_string(),
            };

            let footnote4 = Footnote {
                locate: 200,
                content: "First note".to_string(),
            };

            assert_eq!(footnote1, footnote2);
            assert_ne!(footnote1, footnote3);
            assert_ne!(footnote1, footnote4);
        }

        #[test]
        fn test_footnote_ordering() {
            let footnote1 = Footnote {
                locate: 100,
                content: "First".to_string(),
            };

            let footnote2 = Footnote {
                locate: 200,
                content: "Second".to_string(),
            };

            let footnote3 = Footnote {
                locate: 150,
                content: "Middle".to_string(),
            };

            assert!(footnote1 < footnote2);
            assert!(footnote2 > footnote1);
            assert!(footnote1 < footnote3);
            assert!(footnote3 < footnote2);
            assert_eq!(footnote1.cmp(&footnote1), std::cmp::Ordering::Equal);
        }

        #[test]
        fn test_footnote_sorting() {
            let mut footnotes = vec![
                Footnote {
                    locate: 300,
                    content: "Third note".to_string(),
                },
                Footnote {
                    locate: 100,
                    content: "First note".to_string(),
                },
                Footnote {
                    locate: 200,
                    content: "Second note".to_string(),
                },
            ];

            footnotes.sort();

            assert_eq!(footnotes[0].locate, 100);
            assert_eq!(footnotes[1].locate, 200);
            assert_eq!(footnotes[2].locate, 300);

            assert_eq!(footnotes[0].content, "First note");
            assert_eq!(footnotes[1].content, "Second note");
            assert_eq!(footnotes[2].content, "Third note");
        }
    }

    #[cfg(feature = "content-builder")]
    mod block_type_tests {
        use crate::types::BlockType;

        #[test]
        fn test_block_type_variants() {
            let _ = BlockType::Text;
            let _ = BlockType::Quote;
            let _ = BlockType::Title;
            let _ = BlockType::Image;
            let _ = BlockType::Audio;
            let _ = BlockType::Video;
            let _ = BlockType::MathML;
        }

        #[test]
        fn test_block_type_debug() {
            let text = format!("{:?}", BlockType::Text);
            assert_eq!(text, "Text");

            let quote = format!("{:?}", BlockType::Quote);
            assert_eq!(quote, "Quote");

            let image = format!("{:?}", BlockType::Image);
            assert_eq!(image, "Image");
        }
    }

    #[cfg(feature = "content-builder")]
    mod style_options_tests {
        use crate::types::{ColorScheme, PageLayout, StyleOptions, TextAlign, TextStyle};

        #[test]
        fn test_style_options_default() {
            let options = StyleOptions::default();

            assert_eq!(options.text.font_size, 1.0);
            assert_eq!(options.text.line_height, 1.6);
            assert_eq!(
                options.text.font_family,
                "-apple-system, Roboto, sans-serif"
            );
            assert_eq!(options.text.font_weight, "normal");
            assert_eq!(options.text.font_style, "normal");
            assert_eq!(options.text.letter_spacing, "normal");
            assert_eq!(options.text.text_indent, 2.0);

            assert_eq!(options.color_scheme.background, "#FFFFFF");
            assert_eq!(options.color_scheme.text, "#000000");
            assert_eq!(options.color_scheme.link, "#6f6f6f");

            assert_eq!(options.layout.margin, 20);
            assert_eq!(options.layout.text_align, TextAlign::Left);
            assert_eq!(options.layout.paragraph_spacing, 16);
        }

        #[test]
        fn test_style_options_custom_values() {
            let text = TextStyle {
                font_size: 1.5,
                line_height: 2.0,
                font_family: "Georgia, serif".to_string(),
                font_weight: "bold".to_string(),
                font_style: "italic".to_string(),
                letter_spacing: "0.1em".to_string(),
                text_indent: 3.0,
            };

            let color_scheme = ColorScheme {
                background: "#F0F0F0".to_string(),
                text: "#333333".to_string(),
                link: "#0066CC".to_string(),
            };

            let layout = PageLayout {
                margin: 30,
                text_align: TextAlign::Center,
                paragraph_spacing: 20,
            };

            let options = StyleOptions { text, color_scheme, layout };

            assert_eq!(options.text.font_size, 1.5);
            assert_eq!(options.text.font_weight, "bold");
            assert_eq!(options.color_scheme.background, "#F0F0F0");
            assert_eq!(options.layout.text_align, TextAlign::Center);
        }

        #[test]
        fn test_text_style_default() {
            let style = TextStyle::default();

            assert_eq!(style.font_size, 1.0);
            assert_eq!(style.line_height, 1.6);
            assert_eq!(style.font_family, "-apple-system, Roboto, sans-serif");
            assert_eq!(style.font_weight, "normal");
            assert_eq!(style.font_style, "normal");
            assert_eq!(style.letter_spacing, "normal");
            assert_eq!(style.text_indent, 2.0);
        }

        #[test]
        fn test_text_style_custom_values() {
            let style = TextStyle {
                font_size: 2.0,
                line_height: 1.8,
                font_family: "Times New Roman".to_string(),
                font_weight: "bold".to_string(),
                font_style: "italic".to_string(),
                letter_spacing: "0.05em".to_string(),
                text_indent: 0.0,
            };

            assert_eq!(style.font_size, 2.0);
            assert_eq!(style.line_height, 1.8);
            assert_eq!(style.font_family, "Times New Roman");
            assert_eq!(style.font_weight, "bold");
            assert_eq!(style.font_style, "italic");
            assert_eq!(style.letter_spacing, "0.05em");
            assert_eq!(style.text_indent, 0.0);
        }

        #[test]
        fn test_text_style_debug() {
            let style = TextStyle::default();
            let debug_str = format!("{:?}", style);
            assert!(debug_str.contains("TextStyle"));
            assert!(debug_str.contains("font_size"));
        }

        #[test]
        fn test_color_scheme_default() {
            let scheme = ColorScheme::default();

            assert_eq!(scheme.background, "#FFFFFF");
            assert_eq!(scheme.text, "#000000");
            assert_eq!(scheme.link, "#6f6f6f");
        }

        #[test]
        fn test_color_scheme_custom_values() {
            let scheme = ColorScheme {
                background: "#000000".to_string(),
                text: "#FFFFFF".to_string(),
                link: "#00FF00".to_string(),
            };

            assert_eq!(scheme.background, "#000000");
            assert_eq!(scheme.text, "#FFFFFF");
            assert_eq!(scheme.link, "#00FF00");
        }

        #[test]
        fn test_color_scheme_debug() {
            let scheme = ColorScheme::default();
            let debug_str = format!("{:?}", scheme);
            assert!(debug_str.contains("ColorScheme"));
            assert!(debug_str.contains("background"));
        }

        #[test]
        fn test_page_layout_default() {
            let layout = PageLayout::default();

            assert_eq!(layout.margin, 20);
            assert_eq!(layout.text_align, TextAlign::Left);
            assert_eq!(layout.paragraph_spacing, 16);
        }

        #[test]
        fn test_page_layout_custom_values() {
            let layout = PageLayout {
                margin: 40,
                text_align: TextAlign::Justify,
                paragraph_spacing: 24,
            };

            assert_eq!(layout.margin, 40);
            assert_eq!(layout.text_align, TextAlign::Justify);
            assert_eq!(layout.paragraph_spacing, 24);
        }

        #[test]
        fn test_page_layout_debug() {
            let layout = PageLayout::default();
            let debug_str = format!("{:?}", layout);
            assert!(debug_str.contains("PageLayout"));
            assert!(debug_str.contains("margin"));
        }

        #[test]
        fn test_text_align_default() {
            let align = TextAlign::default();
            assert_eq!(align, TextAlign::Left);
        }

        #[test]
        fn test_text_align_display() {
            assert_eq!(TextAlign::Left.to_string(), "left");
            assert_eq!(TextAlign::Right.to_string(), "right");
            assert_eq!(TextAlign::Justify.to_string(), "justify");
            assert_eq!(TextAlign::Center.to_string(), "center");
        }

        #[test]
        fn test_text_align_all_variants() {
            let left = TextAlign::Left;
            let right = TextAlign::Right;
            let justify = TextAlign::Justify;
            let center = TextAlign::Center;

            assert!(matches!(left, TextAlign::Left));
            assert!(matches!(right, TextAlign::Right));
            assert!(matches!(justify, TextAlign::Justify));
            assert!(matches!(center, TextAlign::Center));
        }

        #[test]
        fn test_text_align_debug() {
            assert_eq!(format!("{:?}", TextAlign::Left), "Left");
            assert_eq!(format!("{:?}", TextAlign::Right), "Right");
            assert_eq!(format!("{:?}", TextAlign::Justify), "Justify");
            assert_eq!(format!("{:?}", TextAlign::Center), "Center");
        }

        #[test]
        fn test_style_options_builder_new() {
            let options = StyleOptions::new();
            assert_eq!(options.text.font_size, 1.0);
            assert_eq!(options.color_scheme.background, "#FFFFFF");
            assert_eq!(options.layout.margin, 20);
        }

        #[test]
        fn test_style_options_builder_with_text() {
            let mut options = StyleOptions::new();
            let text_style = TextStyle::new()
                .with_font_size(2.0)
                .with_font_weight("bold")
                .build();
            options.with_text(text_style);

            assert_eq!(options.text.font_size, 2.0);
            assert_eq!(options.text.font_weight, "bold");
        }

        #[test]
        fn test_style_options_builder_with_color_scheme() {
            let mut options = StyleOptions::new();
            let color = ColorScheme::new()
                .with_background("#000000")
                .with_text("#FFFFFF")
                .build();
            options.with_color_scheme(color);

            assert_eq!(options.color_scheme.background, "#000000");
            assert_eq!(options.color_scheme.text, "#FFFFFF");
        }

        #[test]
        fn test_style_options_builder_with_layout() {
            let mut options = StyleOptions::new();
            let layout = PageLayout::new()
                .with_margin(40)
                .with_text_align(TextAlign::Justify)
                .with_paragraph_spacing(24)
                .build();
            options.with_layout(layout);

            assert_eq!(options.layout.margin, 40);
            assert_eq!(options.layout.text_align, TextAlign::Justify);
            assert_eq!(options.layout.paragraph_spacing, 24);
        }

        #[test]
        fn test_style_options_builder_build() {
            let options = StyleOptions::new()
                .with_text(TextStyle::new().with_font_size(1.5).build())
                .with_color_scheme(ColorScheme::new().with_link("#FF0000").build())
                .with_layout(PageLayout::new().with_margin(30).build())
                .build();

            assert_eq!(options.text.font_size, 1.5);
            assert_eq!(options.color_scheme.link, "#FF0000");
            assert_eq!(options.layout.margin, 30);
        }

        #[test]
        fn test_style_options_builder_chaining() {
            let options = StyleOptions::new()
                .with_text(
                    TextStyle::new()
                        .with_font_size(1.5)
                        .with_line_height(2.0)
                        .with_font_family("Arial")
                        .with_font_weight("bold")
                        .with_font_style("italic")
                        .with_letter_spacing("0.1em")
                        .with_text_indent(1.5)
                        .build(),
                )
                .with_color_scheme(
                    ColorScheme::new()
                        .with_background("#CCCCCC")
                        .with_text("#111111")
                        .with_link("#0000FF")
                        .build(),
                )
                .with_layout(
                    PageLayout::new()
                        .with_margin(25)
                        .with_text_align(TextAlign::Right)
                        .with_paragraph_spacing(20)
                        .build(),
                )
                .build();

            assert_eq!(options.text.font_size, 1.5);
            assert_eq!(options.text.line_height, 2.0);
            assert_eq!(options.text.font_family, "Arial");
            assert_eq!(options.text.font_weight, "bold");
            assert_eq!(options.text.font_style, "italic");
            assert_eq!(options.text.letter_spacing, "0.1em");
            assert_eq!(options.text.text_indent, 1.5);

            assert_eq!(options.color_scheme.background, "#CCCCCC");
            assert_eq!(options.color_scheme.text, "#111111");
            assert_eq!(options.color_scheme.link, "#0000FF");

            assert_eq!(options.layout.margin, 25);
            assert_eq!(options.layout.text_align, TextAlign::Right);
            assert_eq!(options.layout.paragraph_spacing, 20);
        }

        #[test]
        fn test_text_style_builder_new() {
            let style = TextStyle::new();
            assert_eq!(style.font_size, 1.0);
            assert_eq!(style.line_height, 1.6);
        }

        #[test]
        fn test_text_style_builder_with_font_size() {
            let mut style = TextStyle::new();
            style.with_font_size(2.5);
            assert_eq!(style.font_size, 2.5);
        }

        #[test]
        fn test_text_style_builder_with_line_height() {
            let mut style = TextStyle::new();
            style.with_line_height(2.0);
            assert_eq!(style.line_height, 2.0);
        }

        #[test]
        fn test_text_style_builder_with_font_family() {
            let mut style = TextStyle::new();
            style.with_font_family("Helvetica, Arial");
            assert_eq!(style.font_family, "Helvetica, Arial");
        }

        #[test]
        fn test_text_style_builder_with_font_weight() {
            let mut style = TextStyle::new();
            style.with_font_weight("bold");
            assert_eq!(style.font_weight, "bold");
        }

        #[test]
        fn test_text_style_builder_with_font_style() {
            let mut style = TextStyle::new();
            style.with_font_style("italic");
            assert_eq!(style.font_style, "italic");
        }

        #[test]
        fn test_text_style_builder_with_letter_spacing() {
            let mut style = TextStyle::new();
            style.with_letter_spacing("0.05em");
            assert_eq!(style.letter_spacing, "0.05em");
        }

        #[test]
        fn test_text_style_builder_with_text_indent() {
            let mut style = TextStyle::new();
            style.with_text_indent(3.0);
            assert_eq!(style.text_indent, 3.0);
        }

        #[test]
        fn test_text_style_builder_build() {
            let style = TextStyle::new()
                .with_font_size(1.8)
                .with_line_height(1.9)
                .build();

            assert_eq!(style.font_size, 1.8);
            assert_eq!(style.line_height, 1.9);
        }

        #[test]
        fn test_text_style_builder_chaining() {
            let style = TextStyle::new()
                .with_font_size(2.0)
                .with_line_height(1.8)
                .with_font_family("Georgia")
                .with_font_weight("bold")
                .with_font_style("italic")
                .with_letter_spacing("0.1em")
                .with_text_indent(0.5)
                .build();

            assert_eq!(style.font_size, 2.0);
            assert_eq!(style.line_height, 1.8);
            assert_eq!(style.font_family, "Georgia");
            assert_eq!(style.font_weight, "bold");
            assert_eq!(style.font_style, "italic");
            assert_eq!(style.letter_spacing, "0.1em");
            assert_eq!(style.text_indent, 0.5);
        }

        #[test]
        fn test_color_scheme_builder_new() {
            let scheme = ColorScheme::new();
            assert_eq!(scheme.background, "#FFFFFF");
            assert_eq!(scheme.text, "#000000");
        }

        #[test]
        fn test_color_scheme_builder_with_background() {
            let mut scheme = ColorScheme::new();
            scheme.with_background("#FF0000");
            assert_eq!(scheme.background, "#FF0000");
        }

        #[test]
        fn test_color_scheme_builder_with_text() {
            let mut scheme = ColorScheme::new();
            scheme.with_text("#333333");
            assert_eq!(scheme.text, "#333333");
        }

        #[test]
        fn test_color_scheme_builder_with_link() {
            let mut scheme = ColorScheme::new();
            scheme.with_link("#0000FF");
            assert_eq!(scheme.link, "#0000FF");
        }

        #[test]
        fn test_color_scheme_builder_build() {
            let scheme = ColorScheme::new().with_background("#123456").build();

            assert_eq!(scheme.background, "#123456");
            assert_eq!(scheme.text, "#000000");
        }

        #[test]
        fn test_color_scheme_builder_chaining() {
            let scheme = ColorScheme::new()
                .with_background("#AABBCC")
                .with_text("#DDEEFF")
                .with_link("#112233")
                .build();

            assert_eq!(scheme.background, "#AABBCC");
            assert_eq!(scheme.text, "#DDEEFF");
            assert_eq!(scheme.link, "#112233");
        }

        #[test]
        fn test_page_layout_builder_new() {
            let layout = PageLayout::new();
            assert_eq!(layout.margin, 20);
            assert_eq!(layout.text_align, TextAlign::Left);
            assert_eq!(layout.paragraph_spacing, 16);
        }

        #[test]
        fn test_page_layout_builder_with_margin() {
            let mut layout = PageLayout::new();
            layout.with_margin(50);
            assert_eq!(layout.margin, 50);
        }

        #[test]
        fn test_page_layout_builder_with_text_align() {
            let mut layout = PageLayout::new();
            layout.with_text_align(TextAlign::Center);
            assert_eq!(layout.text_align, TextAlign::Center);
        }

        #[test]
        fn test_page_layout_builder_with_paragraph_spacing() {
            let mut layout = PageLayout::new();
            layout.with_paragraph_spacing(30);
            assert_eq!(layout.paragraph_spacing, 30);
        }

        #[test]
        fn test_page_layout_builder_build() {
            let layout = PageLayout::new().with_margin(35).build();

            assert_eq!(layout.margin, 35);
            assert_eq!(layout.text_align, TextAlign::Left);
        }

        #[test]
        fn test_page_layout_builder_chaining() {
            let layout = PageLayout::new()
                .with_margin(45)
                .with_text_align(TextAlign::Justify)
                .with_paragraph_spacing(28)
                .build();

            assert_eq!(layout.margin, 45);
            assert_eq!(layout.text_align, TextAlign::Justify);
            assert_eq!(layout.paragraph_spacing, 28);
        }

        #[test]
        fn test_page_layout_builder_all_text_align_variants() {
            let left = PageLayout::new().with_text_align(TextAlign::Left).build();
            assert_eq!(left.text_align, TextAlign::Left);

            let right = PageLayout::new().with_text_align(TextAlign::Right).build();
            assert_eq!(right.text_align, TextAlign::Right);

            let center = PageLayout::new().with_text_align(TextAlign::Center).build();
            assert_eq!(center.text_align, TextAlign::Center);

            let justify = PageLayout::new()
                .with_text_align(TextAlign::Justify)
                .build();
            assert_eq!(justify.text_align, TextAlign::Justify);
        }
    }
}
