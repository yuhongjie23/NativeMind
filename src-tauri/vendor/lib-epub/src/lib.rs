//! Epub library
//!
//! A Rust library for reading and manipulating EPUB eBook files.
//!
//! This library provides complete EPUB file parsing functionality,
//! supporting EPUB 2 and EPUB 3 formats. It can extract metadata,
//! access content files, and handle encrypted resources.
//! Furthermore, this library also provides a convenient way to build
//! epub files from a set of resources.
//!
//! ## Features
//!
//! - Parse EPUB file structure and containers, extract metadata, access resource files.
//! - Automatic handle encrypted content.
//! - Optional EPUB build functionality via 'builder' feature.
//! - EPUB specification-compliant verification mechanism.
//!
//! ## Quick Start
//!
//! ### Read EPUB Files
//!
//! ```rust, no_run
//! # use lib_epub::epub::EpubDoc;
//! # fn main() -> Result<(), lib_epub::error::EpubError> {
//! // Open EPUB file
//! let mut doc = EpubDoc::new("path/to/epub/file.epub")?;
//!
//! // Get metadata
//! println!("Title: {:?}", doc.get_title());
//! println!("Creator: {:?}", doc.get_metadata_value("creator"));
//!
//! // Read content
//! if let Some((_content, _mime)) = doc.spine_current() { todo!() };
//! if let Some((_content, _mime)) = doc.spine_next() { todo!() };
//!
//! # Ok(())
//! # }
//! ```
//!
//! ## Feature flags
//!
//! This crate uses 2 feature flags to reduce the needless code for your project.
//! By default, this crate only provides structs and trait related to reading and parsing EPUB documents.
//! If you want to use more features related to EPUB, please use the feature flag
//! to turn on the section you need.
//!
//! - `builder`: Enable `lib_epub::builder`, provides structs and trait related to building EPUB documents.
//! - `content-builder`: Enable `lib_epub::builder::content`, provides structs and trait
//!   related to building EPUB content documents. Enabling this feature will turn on
//!   the `builder` feature by default.
//! - `no-indexmap`: Remove the dependency on the external crate `IndexMap`. This dependency
//!   is primarily used to ensure the order of resources in the manifest, as recommended
//!   by the EPUB specification.

pub(crate) mod utils;

#[cfg(feature = "builder")]
pub mod builder;
pub mod epub;
pub mod error;
pub mod types;

pub use utils::DecodeBytes;
