//! Error Type Definition Module
//!
//! This module defines the various error types that may be encountered during
//! EPUB file parsing and processing. All errors are uniformly wrapped in the
//! `EpubError` enumeration for convenient error handling by the caller.

use thiserror::Error;

/// Types of errors that can occur during EPUB processing
///
/// This enumeration defines the various error cases that can be encountered
/// when parsing and processing EPUB files, including file format errors,
/// missing resources, compression issues, etc.
#[derive(Debug, Error)]
pub enum EpubError {
    /// ZIP archive related errors
    ///
    /// Errors occur when processing the ZIP structure of EPUB files,
    /// such as file corruption, unreadability, etc.
    #[error("Archive error: {source}")]
    ArchiveError { source: zip::result::ZipError },

    /// Data Decoding Error - Null data
    ///
    /// This error occurs when trying to decode an empty stream or when the data
    /// is too short to determine the encoding format.
    #[error("Decode error: The data is empty.")]
    EmptyDataError,

    #[cfg(feature = "builder")]
    #[error("Epub builder error: {source}")]
    EpubBuilderError { source: EpubBuilderError },

    /// XML parsing failure error
    ///
    /// This error occurs when an exception happens during the XML parsing process,
    /// such as malformed XML syntax, unclosed tags, or invalid characters.
    /// The parser uses the `quick_xml` library for efficient XML parsing.
    #[error(
        "Failed parsing XML error: Unknown problems occurred during XML parsing, causing parsing failure."
    )]
    FailedParsingXml,

    #[error("IO error: {source}")]
    IOError { source: std::io::Error },

    /// Missing required attribute error
    ///
    /// Triggered when an XML element in an EPUB file lacks the required
    /// attributes required by the EPUB specification.
    #[error(
        "Missing required attribute: The \"{attribute}\" attribute is a must attribute for the \"{tag}\" element."
    )]
    MissingRequiredAttribute { tag: String, attribute: String },

    /// Mutex error
    ///
    /// This error occurs when a mutex is poisoned, which means
    /// that a thread has panicked while holding a lock on the mutex.
    #[error("Mutex error: Mutex was poisoned.")]
    MutexError,

    /// Non-canonical EPUB structure error
    ///
    /// This error occurs when an EPUB file lacks some files or directory
    /// structure that is required in EPUB specification.
    #[error("Non-canonical epub: The \"{expected_file}\" file was not found.")]
    NonCanonicalEpub { expected_file: String },

    /// Non-canonical file structure error
    ///
    /// This error is triggered when the required XML elements in the
    /// specification are missing from the EPUB file.
    #[error("Non-canonical file: The \"{tag}\" elements was not found.")]
    NonCanonicalFile { tag: String },

    /// Missing supported file format error
    ///
    /// This error occurs when trying to get a resource but there isn't any supported file format.
    /// It usually happens when there are no supported formats available in the fallback chain.
    #[error(
        "No supported file format: The fallback resource does not contain the file format you support."
    )]
    NoSupportedFileFormat,

    /// Relative link leak error
    ///
    /// This error occurs when a relative path link is outside the scope
    /// of an EPUB container, which is a security protection mechanism.
    #[error("Relative link leakage: Path \"{path}\" is out of container range.")]
    RelativeLinkLeakage { path: String },

    /// Unable to find the resource id error
    ///
    /// This error occurs when trying to get a resource by id but that id doesn't exist in the manifest.
    #[error("Resource Id Not Exist: There is no resource item with id \"{id}\".")]
    ResourceIdNotExist { id: String },

    /// Unable to find the resource error
    ///
    /// This error occurs when an attempt is made to get a resource
    /// but it does not exist in the EPUB container.
    #[error("Resource not found: Unable to find resource from \"{resource}\".")]
    ResourceNotFound { resource: String },

    /// Unrecognized EPUB version error
    ///
    /// This error occurs when parsing epub files, the library cannot
    /// directly or indirectly identify the epub version number.
    #[error(
        "Unrecognized EPUB version: Unable to identify version number and version characteristics from epub file"
    )]
    UnrecognizedEpubVersion,

    /// Unsupported encryption method error
    ///
    /// This error is triggered when attempting to decrypt a resource that uses
    /// an encryption method not supported by this library.
    ///
    /// Currently, this library only supports:
    /// - IDPF Font Obfuscation
    /// - Adobe Font Obfuscation
    #[error("Unsupported encryption method: The \"{method}\" encryption method is not supported.")]
    UnsupportedEncryptedMethod { method: String },

    /// Unusable compression method error
    ///
    /// This error occurs when an EPUB file uses an unsupported compression method.
    #[error(
        "Unusable compression method: The \"{file}\" file uses the unsupported \"{method}\" compression method."
    )]
    UnusableCompressionMethod { file: String, method: String },

    /// UTF-8 decoding error
    ///
    /// This error occurs when attempting to decode byte data into a UTF-8 string
    /// but the data is not formatted correctly.
    #[error("Decode error: {source}")]
    Utf8DecodeError { source: std::string::FromUtf8Error },

    /// UTF-16 decoding error
    ///
    /// This error occurs when attempting to decode byte data into a UTF-16 string
    /// but the data is not formatted correctly.
    #[error("Decode error: {source}")]
    Utf16DecodeError { source: std::string::FromUtf16Error },

    /// WalkDir error
    ///
    /// This error occurs when using the WalkDir library to traverse the directory.
    #[cfg(feature = "builder")]
    #[error("WalkDir error: {source}")]
    WalkDirError { source: walkdir::Error },

    /// QuickXml error
    ///
    /// This error occurs when parsing XML data using the QuickXml library.
    #[error("QuickXml error: {source}")]
    QuickXmlError { source: quick_xml::Error },
}

impl From<zip::result::ZipError> for EpubError {
    fn from(value: zip::result::ZipError) -> Self {
        EpubError::ArchiveError { source: value }
    }
}

impl From<quick_xml::Error> for EpubError {
    fn from(value: quick_xml::Error) -> Self {
        EpubError::QuickXmlError { source: value }
    }
}

impl From<std::io::Error> for EpubError {
    fn from(value: std::io::Error) -> Self {
        EpubError::IOError { source: value }
    }
}

impl From<std::string::FromUtf8Error> for EpubError {
    fn from(value: std::string::FromUtf8Error) -> Self {
        EpubError::Utf8DecodeError { source: value }
    }
}

impl From<std::string::FromUtf16Error> for EpubError {
    fn from(value: std::string::FromUtf16Error) -> Self {
        EpubError::Utf16DecodeError { source: value }
    }
}

impl<T> From<std::sync::PoisonError<T>> for EpubError {
    fn from(_value: std::sync::PoisonError<T>) -> Self {
        EpubError::MutexError
    }
}

#[cfg(feature = "builder")]
impl From<EpubBuilderError> for EpubError {
    fn from(value: EpubBuilderError) -> Self {
        EpubError::EpubBuilderError { source: value }
    }
}

#[cfg(feature = "builder")]
impl From<walkdir::Error> for EpubError {
    fn from(value: walkdir::Error) -> Self {
        EpubError::WalkDirError { source: value }
    }
}

#[cfg(test)]
impl PartialEq for EpubError {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (
                Self::MissingRequiredAttribute { tag: l_tag, attribute: l_attribute },
                Self::MissingRequiredAttribute { tag: r_tag, attribute: r_attribute },
            ) => l_tag == r_tag && l_attribute == r_attribute,

            (
                Self::NonCanonicalEpub { expected_file: l_expected_file },
                Self::NonCanonicalEpub { expected_file: r_expected_file },
            ) => l_expected_file == r_expected_file,

            (Self::NonCanonicalFile { tag: l_tag }, Self::NonCanonicalFile { tag: r_tag }) => {
                l_tag == r_tag
            }

            (
                Self::RelativeLinkLeakage { path: l_path },
                Self::RelativeLinkLeakage { path: r_path },
            ) => l_path == r_path,

            (Self::ResourceIdNotExist { id: l_id }, Self::ResourceIdNotExist { id: r_id }) => {
                l_id == r_id
            }

            (
                Self::ResourceNotFound { resource: l_resource },
                Self::ResourceNotFound { resource: r_resource },
            ) => l_resource == r_resource,

            (
                Self::UnsupportedEncryptedMethod { method: l_method },
                Self::UnsupportedEncryptedMethod { method: r_method },
            ) => l_method == r_method,

            (
                Self::UnusableCompressionMethod { file: l_file, method: l_method },
                Self::UnusableCompressionMethod { file: r_file, method: r_method },
            ) => l_file == r_file && l_method == r_method,

            (
                Self::Utf8DecodeError { source: l_source },
                Self::Utf8DecodeError { source: r_source },
            ) => l_source == r_source,

            #[cfg(feature = "builder")]
            (
                Self::EpubBuilderError { source: l_source },
                Self::EpubBuilderError { source: r_source },
            ) => l_source == r_source,

            _ => core::mem::discriminant(self) == core::mem::discriminant(other),
        }
    }
}

/// Types of errors that can occur during EPUB build
///
/// This enumeration defines various error conditions that may occur
/// when creating EPUB files using the `builder` function. These errors
/// are typically related to EPUB specification requirements or validation
/// rules during the build process.
#[cfg(feature = "builder")]
#[derive(Debug, Error)]
#[cfg_attr(test, derive(PartialEq))]
pub enum EpubBuilderError {
    /// Illegal manifest path error
    ///
    /// This error is triggered when the path corresponding to a resource ID
    /// in the manifest begins with "../". Using relative paths starting with "../"
    /// when building the manifest fails to determine the 'current location',
    /// making it impossible to pinpoint the resource.
    #[error(
        "A manifest with id '{manifest_id}' should not use a relative path starting with '../'."
    )]
    IllegalManifestPath { manifest_id: String },

    /// Invalid rootfile path error
    ///
    /// This error is triggered when the rootfile path in the container.xml is invalid.
    /// According to the EPUB specification, rootfile paths must be relative paths
    /// that do not start with "../" to prevent directory traversal outside the EPUB container.
    #[error("A rootfile path should be a relative path and not start with '../'.")]
    IllegalRootfilePath,

    /// Invalid footnote locate error
    ///
    /// This error is triggered when the footnote locate is out of range.
    #[error("The footnote locate must be in the range of [0, {max_locate}].")]
    InvalidFootnoteLocate { max_locate: usize },

    /// Invalid mathml format error
    ///
    /// This error is triggered when parsing mathml fails.
    #[error("{error}")]
    InvalidMathMLFormat { error: String },

    /// Invalid target path error
    ///
    /// This error is triggered when the target path terminates in a root or prefix,
    /// or if it's the empty string.
    #[error("The '{target_path}' target path is invalid.")]
    InvalidTargetPath { target_path: String },

    /// Manifest Circular Reference error
    ///
    /// This error is triggered when a fallback relationship between manifest items forms a cycle.
    #[error("Circular reference detected in fallback chain for '{fallback_chain}'.")]
    ManifestCircularReference { fallback_chain: String },

    /// Manifest resource not found error
    ///
    /// This error is triggered when a manifest item specifies a fallback resource ID that does not exist.
    #[error("Fallback resource '{manifest_id}' does not exist in manifest.")]
    ManifestNotFound { manifest_id: String },

    /// Missing necessary metadata error
    ///
    /// This error is triggered when the basic metadata required to build a valid EPUB is missing.
    /// The following must be included: title, language, and an identifier with a 'pub-id' ID.
    #[error("Requires at least one 'title', 'language', and 'identifier' with id 'pub-id'.")]
    MissingNecessaryMetadata,

    /// Missing necessary block data error
    ///
    /// This error is triggered when a block is missing necessary data.
    #[error("The block '{block_type}' is missing necessary data '{missing_data}'")]
    MissingNecessaryBlockData {
        block_type: String,
        missing_data: String,
    },

    /// Navigation information uninitialized error
    ///
    /// This error is triggered when attempting to build an EPUB but without setting navigation information.
    #[error("Navigation information is not set.")]
    NavigationInfoUninitalized,

    /// Not expected file format error
    ///
    /// This error is triggered when build a `Blocl` with unmatched file format.
    #[error("The file format is not current block expected.")]
    NotExpectedFileFormat,

    /// Missing rootfile error
    ///
    /// This error is triggered when attempting to build an EPUB without adding any 'rootfile'.
    #[error("Need at least one rootfile.")]
    MissingRootfile,

    /// Spine manifest reference not found error
    ///
    /// This error is triggered when a spine item references a manifest item
    /// that does not exist in the manifest. Each spine item's `idref` must
    /// correspond to an existing item in the manifest.
    #[error("Spine item '{idref}' references a manifest item that does not exist.")]
    SpineManifestNotFound { idref: String },

    /// Target is not a file error
    ///
    /// This error is triggered when the specified target path is not a file.
    #[error("Expect a file, but '{target_path}' is not a file.")]
    TargetIsNotFile { target_path: String },

    /// Too many nav flags error
    ///
    /// This error is triggered when the manifest contains multiple items with
    /// the `nav` attribute. The EPUB specification requires that each EPUB have
    /// **only one** navigation document.
    #[error("There are too many items with 'nav' property in the manifest.")]
    TooManyNavFlags,

    /// Unknown file format error
    ///
    /// This error is triggered when the format type of the specified file cannot be analyzed.
    #[error("Unable to analyze the file '{file_path}' type.")]
    UnknownFileFormat { file_path: String },
}

#[cfg(test)]
mod from_trait_tests {
    use zip::result::ZipError;

    use std::io;

    use super::*;

    #[test]
    fn test_from_zip_error() {
        let zip_err = ZipError::FileNotFound;
        let epub_err = zip_err.into();

        match epub_err {
            EpubError::ArchiveError { source } => {
                assert!(matches!(source, ZipError::FileNotFound));
            }
            _ => panic!("Expected EpubError::ArchiveError"),
        }
    }

    #[test]
    fn test_from_quick_xml_error() {
        let io_err = io::Error::new(io::ErrorKind::InvalidData, "xml parse error");
        let xml_err = quick_xml::Error::Io(io_err.into());
        let epub_err = xml_err.into();

        match epub_err {
            EpubError::QuickXmlError { source } => {
                assert!(format!("{}", source).contains("xml parse error"));
            }
            _ => panic!("Expected EpubError::QuickXmlError"),
        }
    }

    #[test]
    fn test_from_io_error() {
        let io_err = io::Error::new(io::ErrorKind::NotFound, "file not found");
        let epub_err = io_err.into();

        match epub_err {
            EpubError::IOError { source } => {
                assert_eq!(source.kind(), io::ErrorKind::NotFound);
            }
            _ => panic!("Expected EpubError::IOError"),
        }
    }

    #[test]
    fn test_from_utf8_error() {
        let invalid_utf8 = vec![0x80, 0x81];
        let utf8_err = String::from_utf8(invalid_utf8).unwrap_err();
        let epub_err = utf8_err.into();

        match epub_err {
            EpubError::Utf8DecodeError { .. } => {}
            _ => panic!("Expected EpubError::Utf8DecodeError"),
        }
    }

    #[test]
    fn test_from_utf16_error() {
        let invalid_utf16 = vec![0xD800];
        let utf16_err = String::from_utf16(&invalid_utf16).unwrap_err();
        let epub_err = utf16_err.into();

        match epub_err {
            EpubError::Utf16DecodeError { .. } => {}
            _ => panic!("Expected EpubError::Utf16DecodeError"),
        }
    }

    #[test]
    fn test_from_poison_error() {
        use std::sync::{Arc, Mutex};
        use std::thread;

        let mutex = Arc::new(Mutex::new(42));

        let mutex_clone = Arc::clone(&mutex);
        let handle = thread::spawn(move || {
            let _guard = mutex_clone.lock().unwrap();
            panic!("panic to poison mutex");
        });

        let _ = handle.join();

        let result = mutex.lock();
        assert!(result.is_err());

        if let Err(poison_err) = result {
            let epub_err: EpubError = poison_err.into();
            assert!(matches!(epub_err, EpubError::MutexError));
        }
    }

    #[cfg(feature = "builder")]
    #[test]
    fn test_from_epub_builder_error() {
        let builder_err = EpubBuilderError::MissingRootfile;
        let epub_err: EpubError = builder_err.into();

        match epub_err {
            EpubError::EpubBuilderError { .. } => {}
            _ => panic!("Expected EpubError::EpubBuilderError"),
        }
    }

    #[cfg(feature = "builder")]
    #[test]
    fn test_from_walkdir_error() {
        let walk_err = walkdir::WalkDir::new("nonexistent_path_12345")
            .into_iter()
            .next()
            .unwrap()
            .unwrap_err();
        let epub_err: EpubError = walk_err.into();

        match epub_err {
            EpubError::WalkDirError { .. } => {}
            _ => panic!("Expected EpubError::WalkDirError"),
        }
    }
}
