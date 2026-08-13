//! Epub content build functionality
//!
//! This module provides functionality for creating EPUB content documents.
//!
//! ## Usage
//! ``` rust, no_run
//! # #[cfg(feature = "content-builder")] {
//! # fn main() -> Result<(), lib_epub::error::EpubError> {
//! use lib_epub::{
//!     builder::content::{Block, BlockBuilder, ContentBuilder},
//!     types::{BlockType, Footnote},
//! };
//!
//! let mut block_builder = BlockBuilder::new(BlockType::Title);
//! block_builder
//!     .set_content("This is a title")
//!     .add_footnote(Footnote {
//!         locate: 15,
//!         content: "This is a footnote.".to_string(),
//!     });
//! let block = block_builder.try_into()?;
//!
//! let mut builder = ContentBuilder::new("chapter1", "zh-CN")?;
//! builder.set_title("My Chapter")
//!     .add_block(block)?
//!     .add_text_block("This is my first chapter.", vec![])?;
//! let _ = builder.make("output.xhtml")?;
//! # Ok(())
//! # }
//! # }
//! ```
//!
//! ## Future Work
//!
//! - Support more types of content `Block`
//!
//! ## Notes
//!
//! - Requires `content-builder` feature to use this module.
//! - All resource files (images, audio, video) must exist on the local file system.
//! - The builder automatically creates a temporary directory for storing files during construction.

use std::{
    collections::HashMap,
    env,
    fs::{self, File},
    io::{Cursor, Read},
    path::{Path, PathBuf},
};

use infer::{Infer, MatcherType};
use log::warn;
use quick_xml::{
    Reader, Writer,
    events::{BytesDecl, BytesEnd, BytesStart, BytesText, Event},
};
use walkdir::WalkDir;

use crate::{
    builder::XmlWriter,
    error::{EpubBuilderError, EpubError},
    types::{BlockType, Footnote, StyleOptions},
    utils::local_time,
};

/// Content Block
///
/// The content block is the basic unit of content in a content document.
/// It can be one of the following types: Text, Quote, Title, Image, Audio, Video, MathML.
///
/// For each type of block, we can add a footnote to it, where Text, Quote and Title's
/// footnote will be added to the content and Image, Audio, Video and MathML's footnote
/// will be added to the caption.
///
/// Each block type has its own structure and required fields. We show the structure
/// of each block so that you can manually write css files for Content for a more
/// beautiful interface.
///
/// In addition, the footnote index in the body has the following structure:
///
/// ```xhtml
/// <a href="#footnote-1" id="ref-1" class="footnote-ref">[1]</a>
/// ```
#[non_exhaustive]
#[derive(Debug)]
pub enum Block {
    /// Text paragraph
    ///
    /// This block represents a paragraph of text. The block structure is as follows:
    ///
    /// ```html
    /// <p class="content-block text-block">
    ///     {{ text.content }}
    /// </p>
    /// ```
    #[non_exhaustive]
    Text {
        content: String,
        footnotes: Vec<Footnote>,
    },

    /// Quote paragraph
    ///
    /// This block represents a paragraph of quoted text. The block structure is as follows:
    ///
    /// ```xhtml
    /// <blockquote class="content-block quote-block">
    ///     {{ quote.content }}
    /// </blockquote>
    /// ```
    #[non_exhaustive]
    Quote {
        content: String,
        footnotes: Vec<Footnote>,
    },

    /// Heading
    ///
    /// The block structure is as follows:
    /// ```xhtml
    /// <h1 class="content-block title-block">
    ///     {{ title.content }}
    /// </h1>
    /// ```
    #[non_exhaustive]
    Title {
        content: String,
        footnotes: Vec<Footnote>,

        /// Heading level
        ///
        /// The valid range is 1 to 6.
        level: usize,
    },

    /// Image block
    ///
    /// The block structure is as follows:
    /// ```xhtml
    /// <figure class="content-block image-block">
    ///     <img src="{{ image.url }}" alt="{{ image.alt }}" />
    ///     <figcaption>
    ///         {{ image.caption }}
    ///     </figcaption>
    /// </figure>
    /// ```
    #[non_exhaustive]
    Image {
        /// Image file path
        url: PathBuf,

        /// Alternative text for the image
        alt: Option<String>,

        /// Caption for the image
        caption: Option<String>,

        footnotes: Vec<Footnote>,
    },

    /// Audio block
    ///
    /// The block structure is as follows:
    /// ```xhtml
    /// <figure class="content-block audio-block">
    ///     <audio src="{{ audio.url }}" controls>
    ///        <p>{{ audio.fallback }}</p>
    ///    </audio>
    ///    <figcaption>
    ///       Audio caption text
    ///   </figcaption>
    /// </figure>
    /// ```
    #[non_exhaustive]
    Audio {
        /// Audio file path
        url: PathBuf,

        /// Fallback text for the audio
        ///
        /// This is used when the audio file cannot be played.
        fallback: String,

        /// Caption for the audio
        caption: Option<String>,

        footnotes: Vec<Footnote>,
    },

    /// Video block
    ///
    /// The block structure is as follows:
    /// ```xhtml
    /// <figure class="content-block video-block">
    ///     <video src="{{ video.url }}" controls>
    ///         <p>{{ video.fallback }}</p>
    ///     </video>
    ///     <figcaption>
    ///         {{ video.caption }}
    ///     </figcaption>
    /// </figure>
    /// ```
    #[non_exhaustive]
    Video {
        /// Video file path
        url: PathBuf,

        /// Fallback text for the video
        ///
        /// This is used when the video file cannot be played.
        fallback: String,

        /// Caption for the video
        caption: Option<String>,

        footnotes: Vec<Footnote>,
    },

    /// MathML block
    ///
    /// The block structure is as follows:
    /// ```xhtml
    /// <figure class="content-block mathml-block">
    ///     {{ mathml.element_str as innerHTML }}
    ///     <img src="{{ mathml.fallback_image }}" class="mathml-fallback" />
    ///     <figcaption>
    ///         {{ mathml.caption }}
    ///     </figcaption>
    /// </figure>
    /// ```
    ///
    /// ## Notes
    /// - The MathML markup is inserted directly without validation. Users must ensure
    ///   the MathML is well-formed.
    /// - The fallback image is displayed when the reading system doesn't support MathML.
    #[non_exhaustive]
    MathML {
        /// MathML element raw data
        ///
        /// This field stores the raw data of the MathML markup, which we do not verify,
        /// and the user needs to make sure it is correct.
        element_str: String,

        /// Fallback image for the MathML block
        ///
        /// This field stores the path to the fallback image, which will be displayed
        /// when the MathML markup cannot be rendered.
        fallback_image: Option<PathBuf>,

        /// Caption for the MathML block
        caption: Option<String>,

        footnotes: Vec<Footnote>,
    },
}

impl Block {
    /// Make the block
    ///
    /// Convert block data to xhtml markup.
    pub(crate) fn make(
        &mut self,
        writer: &mut XmlWriter,
        start_index: usize,
    ) -> Result<(), EpubError> {
        match self {
            Block::Text { content, footnotes } => {
                writer.write_event(Event::Start(
                    BytesStart::new("p").with_attributes([("class", "content-block text-block")]),
                ))?;

                Self::make_text(writer, content, footnotes, start_index)?;

                writer.write_event(Event::End(BytesEnd::new("p")))?;
            }

            Block::Quote { content, footnotes } => {
                writer.write_event(Event::Start(BytesStart::new("blockquote").with_attributes(
                    [
                        ("class", "content-block quote-block"),
                        ("cite", "SOME ATTR NEED TO BE SET"),
                    ],
                )))?;
                writer.write_event(Event::Start(BytesStart::new("p")))?;

                Self::make_text(writer, content, footnotes, start_index)?;

                writer.write_event(Event::End(BytesEnd::new("p")))?;
                writer.write_event(Event::End(BytesEnd::new("blockquote")))?;
            }

            Block::Title { content, footnotes, level } => {
                let tag_name = format!("h{}", level);
                writer.write_event(Event::Start(
                    BytesStart::new(tag_name.as_str())
                        .with_attributes([("class", "content-block title-block")]),
                ))?;

                Self::make_text(writer, content, footnotes, start_index)?;

                writer.write_event(Event::End(BytesEnd::new(tag_name)))?;
            }

            Block::Image { url, alt, caption, footnotes } => {
                let url = format!("./img/{}", url.file_name().unwrap().to_string_lossy());

                let mut attr = Vec::new();
                attr.push(("src", url.as_str()));
                if let Some(alt) = alt {
                    attr.push(("alt", alt.as_str()));
                }

                writer.write_event(Event::Start(
                    BytesStart::new("figure")
                        .with_attributes([("class", "content-block image-block")]),
                ))?;
                writer.write_event(Event::Empty(BytesStart::new("img").with_attributes(attr)))?;

                if let Some(caption) = caption {
                    writer.write_event(Event::Start(BytesStart::new("figcaption")))?;

                    Self::make_text(writer, caption, footnotes, start_index)?;

                    writer.write_event(Event::End(BytesEnd::new("figcaption")))?;
                }

                writer.write_event(Event::End(BytesEnd::new("figure")))?;
            }

            Block::Audio { url, fallback, caption, footnotes } => {
                let url = format!("./audio/{}", url.file_name().unwrap().to_string_lossy());

                let attr = vec![
                    ("src", url.as_str()),
                    ("controls", "controls"), // attribute special spelling for xhtml
                ];

                writer.write_event(Event::Start(
                    BytesStart::new("figure")
                        .with_attributes([("class", "content-block audio-block")]),
                ))?;
                writer.write_event(Event::Start(BytesStart::new("audio").with_attributes(attr)))?;

                writer.write_event(Event::Start(BytesStart::new("p")))?;
                writer.write_event(Event::Text(BytesText::new(fallback.as_str())))?;
                writer.write_event(Event::End(BytesEnd::new("p")))?;

                writer.write_event(Event::End(BytesEnd::new("audio")))?;

                if let Some(caption) = caption {
                    writer.write_event(Event::Start(BytesStart::new("figcaption")))?;

                    Self::make_text(writer, caption, footnotes, start_index)?;

                    writer.write_event(Event::End(BytesEnd::new("figcaption")))?;
                }

                writer.write_event(Event::End(BytesEnd::new("figure")))?;
            }

            Block::Video { url, fallback, caption, footnotes } => {
                let url = format!("./video/{}", url.file_name().unwrap().to_string_lossy());

                let attr = vec![
                    ("src", url.as_str()),
                    ("controls", "controls"), // attribute special spelling for xhtml
                ];

                writer.write_event(Event::Start(
                    BytesStart::new("figure")
                        .with_attributes([("class", "content-block video-block")]),
                ))?;
                writer.write_event(Event::Start(BytesStart::new("video").with_attributes(attr)))?;

                writer.write_event(Event::Start(BytesStart::new("p")))?;
                writer.write_event(Event::Text(BytesText::new(fallback.as_str())))?;
                writer.write_event(Event::End(BytesEnd::new("p")))?;

                writer.write_event(Event::End(BytesEnd::new("video")))?;

                if let Some(caption) = caption {
                    writer.write_event(Event::Start(BytesStart::new("figcaption")))?;

                    Self::make_text(writer, caption, footnotes, start_index)?;

                    writer.write_event(Event::End(BytesEnd::new("figcaption")))?;
                }

                writer.write_event(Event::End(BytesEnd::new("figure")))?;
            }

            Block::MathML {
                element_str,
                fallback_image,
                caption,
                footnotes,
            } => {
                writer.write_event(Event::Start(
                    BytesStart::new("figure")
                        .with_attributes([("class", "content-block mathml-block")]),
                ))?;

                Self::write_mathml_element(writer, element_str)?;

                if let Some(fallback_path) = fallback_image {
                    let img_url = format!(
                        "./img/{}",
                        fallback_path.file_name().unwrap().to_string_lossy()
                    );

                    writer.write_event(Event::Empty(BytesStart::new("img").with_attributes([
                        ("src", img_url.as_str()),
                        ("class", "mathml-fallback"),
                        ("alt", "Mathematical formula"),
                    ])))?;
                }

                if let Some(caption) = caption {
                    writer.write_event(Event::Start(BytesStart::new("figcaption")))?;

                    Self::make_text(writer, caption, footnotes, start_index)?;

                    writer.write_event(Event::End(BytesEnd::new("figcaption")))?;
                }

                writer.write_event(Event::End(BytesEnd::new("figure")))?;
            }
        }

        Ok(())
    }

    pub fn take_footnotes(&self) -> Vec<Footnote> {
        match self {
            Block::Text { footnotes, .. }
            | Block::Quote { footnotes, .. }
            | Block::Title { footnotes, .. }
            | Block::Image { footnotes, .. }
            | Block::Audio { footnotes, .. }
            | Block::Video { footnotes, .. }
            | Block::MathML { footnotes, .. } => footnotes.to_vec(),
        }
    }

    /// Split content by footnote locate
    ///
    /// ## Parameters
    /// - `content`: The content to split
    /// - `index_list`: The locations of footnotes
    fn split_content_by_index(content: &str, index_list: &[usize]) -> Vec<String> {
        if index_list.is_empty() {
            return vec![content.to_string()];
        }

        // index_list.len() footnote splits content into (index_list.len() + 1) parts.
        let mut result = Vec::with_capacity(index_list.len() + 1);
        let mut char_iter = content.chars().enumerate();

        let mut current_char_idx = 0;
        for &target_idx in index_list {
            let mut segment = String::new();

            // The starting range is the last location or 0,
            // and the ending range is the current location.
            while current_char_idx < target_idx {
                if let Some((_, ch)) = char_iter.next() {
                    segment.push(ch);
                    current_char_idx += 1;
                } else {
                    break;
                }
            }

            if !segment.is_empty() {
                result.push(segment);
            }
        }

        let remainder = char_iter.map(|(_, ch)| ch).collect::<String>();
        if !remainder.is_empty() {
            result.push(remainder);
        }

        result
    }

    /// Make text
    ///
    /// This function is used to format text content and footnote markup.
    ///
    /// ## Parameters
    /// - `writer`: The writer to write XML events
    /// - `content`: The text content to format
    /// - `footnotes`: The footnotes to format
    /// - `start_index`: The starting value of footnote number
    fn make_text(
        writer: &mut XmlWriter,
        content: &str,
        footnotes: &mut [Footnote],
        start_index: usize,
    ) -> Result<(), EpubError> {
        if footnotes.is_empty() {
            writer.write_event(Event::Text(BytesText::new(content)))?;
            return Ok(());
        }

        footnotes.sort_unstable();

        // statistical footnote locate and quantity
        let mut position_to_count = HashMap::new();
        for footnote in footnotes.iter() {
            *position_to_count.entry(footnote.locate).or_insert(0usize) += 1;
        }

        let mut positions = position_to_count.keys().copied().collect::<Vec<usize>>();
        positions.sort_unstable();

        let mut current_index = start_index;
        let content_list = Self::split_content_by_index(content, &positions);
        for (index, segment) in content_list.iter().enumerate() {
            writer.write_event(Event::Text(BytesText::new(segment)))?;

            // get the locate of the index-th footnote
            if let Some(&position) = positions.get(index) {
                // get the quantity of the index-th footnote
                if let Some(&count) = position_to_count.get(&position) {
                    for _ in 0..count {
                        Self::make_footnotes(writer, current_index)?;
                        current_index += 1;
                    }
                }
            }
        }

        Ok(())
    }

    /// Makes footnote reference markup
    #[inline]
    fn make_footnotes(writer: &mut XmlWriter, index: usize) -> Result<(), EpubError> {
        writer.write_event(Event::Start(BytesStart::new("a").with_attributes([
            ("href", format!("#footnote-{}", index).as_str()),
            ("id", format!("ref-{}", index).as_str()),
            ("class", "footnote-ref"),
        ])))?;
        writer.write_event(Event::Text(BytesText::new(&format!("[{}]", index))))?;
        writer.write_event(Event::End(BytesEnd::new("a")))?;

        Ok(())
    }

    /// Write MathML element
    ///
    /// This function will parse the MathML element string and write it to the writer.
    fn write_mathml_element(writer: &mut XmlWriter, element_str: &str) -> Result<(), EpubError> {
        let mut reader = Reader::from_str(element_str);

        loop {
            match reader.read_event() {
                Ok(Event::Eof) => break,

                Ok(event) => writer.write_event(event)?,

                Err(err) => {
                    return Err(
                        EpubBuilderError::InvalidMathMLFormat { error: err.to_string() }.into(),
                    );
                }
            }
        }

        Ok(())
    }

    /// Validates the footnotes in a block
    ///
    /// Ensures all footnotes reference valid positions within the content.
    /// For Text, Quote, and Title blocks, footnotes must be within the character count of the content.
    /// For Image, Audio, Video, and MathML blocks, footnotes must be within the character count
    /// of the caption (if a caption is set). Blocks with media but no caption cannot have footnotes.
    fn validate_footnotes(&self) -> Result<(), EpubError> {
        match self {
            Block::Text { content, footnotes }
            | Block::Quote { content, footnotes }
            | Block::Title { content, footnotes, .. } => {
                let max_locate = content.chars().count();
                for footnote in footnotes.iter() {
                    if footnote.locate == 0 || footnote.locate > max_locate {
                        return Err(EpubBuilderError::InvalidFootnoteLocate { max_locate }.into());
                    }
                }

                Ok(())
            }

            Block::Image { caption, footnotes, .. }
            | Block::MathML { caption, footnotes, .. }
            | Block::Video { caption, footnotes, .. }
            | Block::Audio { caption, footnotes, .. } => {
                if let Some(caption) = caption {
                    let max_locate = caption.chars().count();
                    for footnote in footnotes.iter() {
                        if footnote.locate == 0 || footnote.locate > caption.chars().count() {
                            return Err(
                                EpubBuilderError::InvalidFootnoteLocate { max_locate }.into()
                            );
                        }
                    }
                } else if !footnotes.is_empty() {
                    return Err(EpubBuilderError::InvalidFootnoteLocate { max_locate: 0 }.into());
                }

                Ok(())
            }
        }
    }

    fn missing_error(block_type: BlockType, missing_data: &str) -> EpubError {
        EpubBuilderError::MissingNecessaryBlockData {
            block_type: block_type.to_string(),
            missing_data: format!("'{}'", missing_data),
        }
        .into()
    }
}

impl TryFrom<BlockBuilder> for Block {
    type Error = EpubError;

    fn try_from(builder: BlockBuilder) -> Result<Self, Self::Error> {
        let block = match builder.block_type {
            BlockType::Text => {
                let content = builder
                    .content
                    .ok_or_else(|| Self::missing_error(builder.block_type, "content"))?;
                Block::Text { content, footnotes: builder.footnotes }
            }

            BlockType::Quote => {
                let content = builder
                    .content
                    .ok_or_else(|| Self::missing_error(builder.block_type, "content"))?;
                Block::Quote { content, footnotes: builder.footnotes }
            }

            BlockType::Title => {
                let content = builder
                    .content
                    .ok_or_else(|| Self::missing_error(builder.block_type, "content"))?;
                let level = builder
                    .level
                    .ok_or_else(|| Self::missing_error(builder.block_type, "level"))?;

                Block::Title {
                    content,
                    footnotes: builder.footnotes,
                    level,
                }
            }

            BlockType::Image => {
                let url = builder
                    .url
                    .ok_or_else(|| Self::missing_error(builder.block_type, "url"))?;

                Block::Image {
                    url,
                    alt: builder.alt,
                    caption: builder.caption,
                    footnotes: builder.footnotes,
                }
            }

            BlockType::Audio => {
                let url = builder
                    .url
                    .ok_or_else(|| Self::missing_error(builder.block_type, "url"))?;
                let fallback = builder
                    .fallback
                    .ok_or_else(|| Self::missing_error(builder.block_type, "fallback"))?;

                Block::Audio {
                    url,
                    fallback,
                    caption: builder.caption,
                    footnotes: builder.footnotes,
                }
            }

            BlockType::Video => {
                let url = builder
                    .url
                    .ok_or_else(|| Self::missing_error(builder.block_type, "url"))?;
                let fallback = builder
                    .fallback
                    .ok_or_else(|| Self::missing_error(builder.block_type, "fallback"))?;

                Block::Video {
                    url,
                    fallback,
                    caption: builder.caption,
                    footnotes: builder.footnotes,
                }
            }

            BlockType::MathML => {
                let element_str = builder
                    .element_str
                    .ok_or_else(|| Self::missing_error(builder.block_type, "element_str"))?;

                Block::MathML {
                    element_str,
                    fallback_image: builder.fallback_image,
                    caption: builder.caption,
                    footnotes: builder.footnotes,
                }
            }
        };

        block.validate_footnotes()?;
        Ok(block)
    }
}

/// Block Builder
///
/// A builder for constructing content blocks of various types.
///
/// ## Example
/// ```rust
/// # #[cfg(feature = "content-builder")]
/// # fn main() -> Result<(), lib_epub::error::EpubError> {
/// use lib_epub::{
///     builder::content::{Block, BlockBuilder},
///     types::{BlockType, Footnote}
/// };
///
/// let mut builder = BlockBuilder::new(BlockType::Text);
/// builder.set_content("Hello, world!").add_footnote(Footnote {
///     content: "This is a footnote.".to_string(),
///     locate: 13,
/// });
///
/// let block: Block = builder.try_into()?;
/// # Ok(())
/// # }
/// ```
///
/// ## Notes
/// - Not all fields are required for all block types. Required fields vary by block type.
#[derive(Debug)]
pub struct BlockBuilder {
    /// The type of block to construct
    block_type: BlockType,

    /// Content text for Text, Quote, and Title blocks
    content: Option<String>,

    /// Heading level (1-6) for Title blocks
    level: Option<usize>,

    /// File path to media for Image, Audio, and Video blocks
    url: Option<PathBuf>,

    /// Alternative text for Image blocks
    alt: Option<String>,

    /// Caption text for Image, Audio, Video, and MathML blocks
    caption: Option<String>,

    /// Fallback text for Audio and Video blocks (displayed when media cannot be played)
    fallback: Option<String>,

    /// Raw MathML markup string for MathML blocks
    element_str: Option<String>,

    /// Fallback image path for MathML blocks (displayed when MathML cannot be rendered)
    fallback_image: Option<PathBuf>,

    /// Footnotes associated with the block content
    footnotes: Vec<Footnote>,
}

impl BlockBuilder {
    /// Creates a new BlockBuilder instance
    ///
    /// Initializes a BlockBuilder with the specified block type.
    ///
    /// ## Parameters
    /// - `block_type`: The type of block to construct
    pub fn new(block_type: BlockType) -> Self {
        Self {
            block_type,
            content: None,
            level: None,
            url: None,
            alt: None,
            caption: None,
            fallback: None,
            element_str: None,
            fallback_image: None,
            footnotes: vec![],
        }
    }

    /// Sets the text content of the block
    ///
    /// Used for Text, Quote, and Title block types.
    ///
    /// ## Parameters
    /// - `content`: The text content to set
    pub fn set_content(&mut self, content: &str) -> &mut Self {
        self.content = Some(content.to_string());
        self
    }

    /// Sets the heading level for a Title block
    ///
    /// Only applicable to Title block types. Valid range is 1 to 6.
    /// If the level is outside the valid range, this method silently ignores the setting
    /// and returns self unchanged.
    ///
    /// ## Parameters
    /// - `level`: The heading level (1-6), corresponding to h1-h6 HTML tags
    pub fn set_title_level(&mut self, level: usize) -> &mut Self {
        if !(1..=6).contains(&level) {
            return self;
        }

        self.level = Some(level);
        self
    }

    /// Sets the media file path
    ///
    /// Used for Image, Audio, and Video block types. This method validates that
    /// the file is a recognized image, audio, or video type.
    ///
    /// ## Parameters
    /// - `url`: The path to the media file
    ///
    /// ## Return
    /// - `Ok(&mut self)`: If the file type is valid
    /// - `Err(EpubError)`: The file does not exist or the file format is not image, audio, or video
    pub fn set_url(&mut self, url: &PathBuf) -> Result<&mut Self, EpubError> {
        match Self::is_target_type(
            url,
            vec![MatcherType::Image, MatcherType::Audio, MatcherType::Video],
        ) {
            Ok(_) => {
                self.url = Some(url.to_path_buf());
                Ok(self)
            }
            Err(err) => Err(err),
        }
    }

    /// Sets the alternative text for an image
    ///
    /// Only applicable to Image block types.
    /// Alternative text is displayed when the image cannot be loaded.
    ///
    /// ## Parameters
    /// - `alt`: The alternative text for the image
    pub fn set_alt(&mut self, alt: &str) -> &mut Self {
        self.alt = Some(alt.to_string());
        self
    }

    /// Sets the caption for the block
    ///
    /// Used for Image, Audio, Video, and MathML block types.
    /// The caption is displayed below the media or element.
    ///
    /// ## Parameters
    /// - `caption`: The caption text to display
    pub fn set_caption(&mut self, caption: &str) -> &mut Self {
        self.caption = Some(caption.to_string());
        self
    }

    /// Sets the fallback text for audio or video content
    ///
    /// Used for Audio and Video block types.
    /// The fallback text is displayed when the media file cannot be played.
    ///
    /// ## Parameters
    /// - `fallback`: The fallback text content
    pub fn set_fallback(&mut self, fallback: &str) -> &mut Self {
        self.fallback = Some(fallback.to_string());
        self
    }

    /// Sets the raw MathML element string
    ///
    /// Only applicable to MathML block types.
    /// This method accepts the raw MathML markup data without validation.
    /// The user is responsible for ensuring the MathML is well-formed.
    ///
    /// ## Parameters
    /// - `element_str`: The raw MathML markup string
    pub fn set_mathml_element(&mut self, element_str: &str) -> &mut Self {
        self.element_str = Some(element_str.to_string());
        self
    }

    /// Sets the fallback image for MathML content
    ///
    /// Only applicable to MathML block types.
    /// The fallback image is displayed when the MathML markup cannot be rendered.
    /// This method validates that the file is a recognized image type.
    ///
    /// ## Parameters
    /// - `fallback_image`: The path to the fallback image file
    ///
    /// ## Return
    /// - `Ok(self)`: If the file type is valid
    /// - `Err(EpubError)`: If validation fails
    pub fn set_fallback_image(&mut self, fallback_image: PathBuf) -> Result<&mut Self, EpubError> {
        match Self::is_target_type(&fallback_image, vec![MatcherType::Image]) {
            Ok(_) => {
                self.fallback_image = Some(fallback_image);
                Ok(self)
            }
            Err(err) => Err(err),
        }
    }

    /// Adds a footnote to the block
    ///
    /// Adds a single footnote to the block's footnotes collection.
    /// The footnote must reference a valid position within the content.
    ///
    /// ## Parameters
    /// - `footnote`: The footnote to add
    pub fn add_footnote(&mut self, footnote: Footnote) -> &mut Self {
        self.footnotes.push(footnote);
        self
    }

    /// Sets all footnotes for the block
    ///
    /// Replaces the current footnotes collection with the provided one.
    /// All footnotes must reference valid positions within the content.
    ///
    /// ## Parameters
    /// - `footnotes`: The vector of footnotes to set
    pub fn set_footnotes(&mut self, footnotes: Vec<Footnote>) -> &mut Self {
        self.footnotes = footnotes;
        self
    }

    /// Builds the block
    ///
    /// Constructs a Block instance based on the configured parameters and block type.
    /// This method validates that all required fields are set for the specified block type
    /// and validates the footnotes to ensure they reference valid content positions.
    ///
    /// ## Return
    /// - `Ok(Block)`: Build successful
    /// - `Err(EpubError)`: Error occurred during the build process
    #[deprecated(since = "0.2.0", note = "use `try_into()` instead")]
    pub fn build(self) -> Result<Block, EpubError> {
        self.try_into()
    }

    /// Validates that the file type matches expected types
    fn is_target_type(path: impl AsRef<Path>, types: Vec<MatcherType>) -> Result<(), EpubError> {
        let path = path.as_ref();
        if !path.is_file() {
            return Err(EpubBuilderError::TargetIsNotFile {
                target_path: path.to_string_lossy().to_string(),
            }
            .into());
        }

        let mut file = File::open(path)?;
        let mut buf = [0; 512];
        let read_size = file.read(&mut buf)?;
        let header_bytes = &buf[..read_size];

        match Infer::new().get(header_bytes) {
            Some(file_type) if !types.contains(&file_type.matcher_type()) => {
                Err(EpubBuilderError::NotExpectedFileFormat.into())
            }

            None => Err(EpubBuilderError::UnknownFileFormat {
                file_path: path.to_string_lossy().to_string(),
            }
            .into()),

            _ => Ok(()),
        }
    }
}

/// Content Builder
///
/// A builder for constructing EPUB content documents with various block types.
/// This builder manages the creation and organization of content blocks including
/// text, quotes, headings, images, audio, video, and MathML content.
///
/// This builder can add simple interface styles via StyleOption or modify document
/// styles by manually write css files.
#[derive(Debug)]
pub struct ContentBuilder {
    /// The unique identifier for the content document
    ///
    /// This identifier is used to uniquely identify the content document within the EPUB container.
    /// If the identifier is not unique, only one content document will be included in the EPUB container;
    /// and the other content document will be ignored.
    pub id: String,

    pub(crate) blocks: Vec<Block>,
    pub(crate) language: String,
    pub(crate) title: String,
    pub(crate) styles: StyleOptions,

    pub(crate) temp_dir: PathBuf,
    pub(crate) css_files: Vec<PathBuf>,
}

impl ContentBuilder {
    // TODO: Handle resource naming conflicts

    /// Creates a new ContentBuilder instance
    ///
    /// Initializes a ContentBuilder with the specified language code.
    /// A temporary directory is automatically created to store media files during construction.
    ///
    /// ## Parameters
    /// - `language`: The language code for the document
    pub fn new(id: &str, language: &str) -> Result<Self, EpubError> {
        let temp_dir = env::temp_dir().join(local_time());
        fs::create_dir(&temp_dir)?;

        Ok(Self {
            id: id.to_string(),
            blocks: vec![],
            language: language.to_string(),
            title: String::new(),
            styles: StyleOptions::default(),
            temp_dir,
            css_files: vec![],
        })
    }

    /// Sets the title displayed in the document's head section.
    pub fn set_title(&mut self, title: &str) -> &mut Self {
        self.title = title.to_string();
        self
    }

    /// Sets the styles for the document
    pub fn set_styles(&mut self, styles: StyleOptions) -> &mut Self {
        self.styles = styles;
        self
    }

    /// Adds a CSS file to the document
    ///
    /// Copies the CSS file to a temporary directory for inclusion in the EPUB package.
    /// The CSS file will be linked in the document's head section when generating the output.
    ///
    /// ## Parameters
    /// - `css_path`: The path to the CSS file to add
    ///
    /// ## Return
    /// - `Ok(&mut self)`: If the file exists and is accessible
    /// - `Err(EpubError)`: If the file does not exist or is not accessible
    pub fn add_css_file(&mut self, css_path: PathBuf) -> Result<&mut Self, EpubError> {
        if !css_path.is_file() {
            return Err(EpubBuilderError::TargetIsNotFile {
                target_path: css_path.to_string_lossy().to_string(),
            }
            .into());
        }

        // we can assert that this path target to a file, so unwrap is safe here
        let file_name = css_path.file_name().unwrap().to_string_lossy().to_string();
        let target_dir = self.temp_dir.join("css");
        fs::create_dir_all(&target_dir)?;

        let target_path = target_dir.join(&file_name);
        fs::copy(&css_path, &target_path)?;
        self.css_files.push(target_path);
        Ok(self)
    }

    /// Adds a block to the document
    ///
    /// Adds a constructed Block to the document.
    ///
    /// ## Parameters
    /// - `block`: The Block to add to the document
    pub fn add_block(&mut self, block: Block) -> Result<&mut Self, EpubError> {
        self.blocks.push(block);

        match self.blocks.last() {
            Some(Block::Image { .. }) | Some(Block::Audio { .. }) | Some(Block::Video { .. }) => {
                self.handle_resource()?
            }

            Some(Block::MathML { fallback_image, .. }) if fallback_image.is_some() => {
                self.handle_resource()?;
            }

            _ => {}
        }

        Ok(self)
    }

    /// Adds a text block to the document
    ///
    /// Convenience method that creates and adds a Text block using the provided content and footnotes.
    ///
    /// ## Parameters
    /// - `content`: The text content of the paragraph
    /// - `footnotes`: A vector of footnotes associated with the text
    pub fn add_text_block(
        &mut self,
        content: &str,
        footnotes: Vec<Footnote>,
    ) -> Result<&mut Self, EpubError> {
        let mut builder = BlockBuilder::new(BlockType::Text);
        builder.set_content(content).set_footnotes(footnotes);

        self.blocks.push(builder.try_into()?);
        Ok(self)
    }

    /// Adds a quote block to the document
    ///
    /// Convenience method that creates and adds a Quote block using the provided content and footnotes.
    ///
    /// ## Parameters
    /// - `content`: The quoted text
    /// - `footnotes`: A vector of footnotes associated with the quote
    pub fn add_quote_block(
        &mut self,
        content: &str,
        footnotes: Vec<Footnote>,
    ) -> Result<&mut Self, EpubError> {
        let mut builder = BlockBuilder::new(BlockType::Quote);
        builder.set_content(content).set_footnotes(footnotes);

        self.blocks.push(builder.try_into()?);
        Ok(self)
    }

    /// Adds a heading block to the document
    ///
    /// Convenience method that creates and adds a Title block with the specified level.
    ///
    /// ## Parameters
    /// - `content`: The heading text
    /// - `level`: The heading level (1-6), corresponding to h1-h6 HTML tags
    /// - `footnotes`: A vector of footnotes associated with the heading
    pub fn add_title_block(
        &mut self,
        content: &str,
        level: usize,
        footnotes: Vec<Footnote>,
    ) -> Result<&mut Self, EpubError> {
        let mut builder = BlockBuilder::new(BlockType::Title);
        builder
            .set_content(content)
            .set_title_level(level)
            .set_footnotes(footnotes);

        self.blocks.push(builder.try_into()?);
        Ok(self)
    }

    /// Adds an image block to the document
    ///
    /// Convenience method that creates and adds an Image block with optional alt text,
    /// caption, and footnotes.
    ///
    /// ## Parameters
    /// - `url`: The path to the image file
    /// - `alt`: Optional alternative text for the image (displayed when image cannot load)
    /// - `caption`: Optional caption text to display below the image
    /// - `footnotes`: A vector of footnotes associated with the caption or image
    pub fn add_image_block(
        &mut self,
        url: PathBuf,
        alt: Option<String>,
        caption: Option<String>,
        footnotes: Vec<Footnote>,
    ) -> Result<&mut Self, EpubError> {
        let mut builder = BlockBuilder::new(BlockType::Image);
        builder.set_url(&url)?.set_footnotes(footnotes);

        if let Some(alt) = &alt {
            builder.set_alt(alt);
        }

        if let Some(caption) = &caption {
            builder.set_caption(caption);
        }

        self.blocks.push(builder.try_into()?);
        self.handle_resource()?;
        Ok(self)
    }

    /// Adds an audio block to the document
    ///
    /// Convenience method that creates and adds an Audio block with fallback text,
    /// optional caption, and footnotes.
    ///
    /// ## Parameters
    /// - `url`: The path to the audio file
    /// - `fallback`: Fallback text displayed when the audio cannot be played
    /// - `caption`: Optional caption text to display below the audio player
    /// - `footnotes`: A vector of footnotes associated with the caption or audio
    pub fn add_audio_block(
        &mut self,
        url: PathBuf,
        fallback: String,
        caption: Option<String>,
        footnotes: Vec<Footnote>,
    ) -> Result<&mut Self, EpubError> {
        let mut builder = BlockBuilder::new(BlockType::Audio);
        builder
            .set_url(&url)?
            .set_fallback(&fallback)
            .set_footnotes(footnotes);

        if let Some(caption) = &caption {
            builder.set_caption(caption);
        }

        self.blocks.push(builder.try_into()?);
        self.handle_resource()?;
        Ok(self)
    }

    /// Adds a video block to the document
    ///
    /// Convenience method that creates and adds a Video block with fallback text,
    /// optional caption, and footnotes.
    ///
    /// ## Parameters
    /// - `url`: The path to the video file
    /// - `fallback`: Fallback text displayed when the video cannot be played
    /// - `caption`: Optional caption text to display below the video player
    /// - `footnotes`: A vector of footnotes associated with the caption or video
    pub fn add_video_block(
        &mut self,
        url: PathBuf,
        fallback: String,
        caption: Option<String>,
        footnotes: Vec<Footnote>,
    ) -> Result<&mut Self, EpubError> {
        let mut builder = BlockBuilder::new(BlockType::Video);
        builder
            .set_url(&url)?
            .set_fallback(&fallback)
            .set_footnotes(footnotes);

        if let Some(caption) = &caption {
            builder.set_caption(caption);
        }

        self.blocks.push(builder.try_into()?);
        self.handle_resource()?;
        Ok(self)
    }

    /// Adds a MathML block to the document
    ///
    /// Convenience method that creates and adds a MathML block with optional fallback image,
    /// caption, and footnotes.
    ///
    /// ## Parameters
    /// - `element_str`: The raw MathML markup string
    /// - `fallback_image`: Optional path to a fallback image displayed when MathML cannot render
    /// - `caption`: Optional caption text to display below the MathML element
    /// - `footnotes`: A vector of footnotes associated with the caption or equation
    pub fn add_mathml_block(
        &mut self,
        element_str: String,
        fallback_image: Option<PathBuf>,
        caption: Option<String>,
        footnotes: Vec<Footnote>,
    ) -> Result<&mut Self, EpubError> {
        let mut builder = BlockBuilder::new(BlockType::MathML);
        builder
            .set_mathml_element(&element_str)
            .set_footnotes(footnotes);

        if let Some(fallback_image) = fallback_image {
            builder.set_fallback_image(fallback_image)?;
        }

        if let Some(caption) = &caption {
            builder.set_caption(caption);
        }

        self.blocks.push(builder.try_into()?);
        self.handle_resource()?;
        Ok(self)
    }

    /// Builds content document
    ///
    /// The final constructed content document has the following structure:
    ///
    /// ```xhtml
    /// <body>
    ///     <main>
    ///         <!-- The specific block structure can be queried in the Block docs. -->
    ///     </main>
    ///     <aside>
    ///         <ul class="footnote-list">
    ///             <!-- Each footnote has the same structure. -->
    ///             <li class="footnote-item" id="footnote-{{ index }}">
    ///                 <p>
    ///                     <a herf="ref-{{ index }}">[{{ index }}]</a>
    ///                     {{ footnote.content }}
    ///                 </p>
    ///             </li>
    ///         </ul>
    ///     </aside>
    /// </body>
    /// ```
    ///
    /// ## Parameters
    /// - `target`: The file path where the document should be written
    ///
    /// ## Return
    /// - `Ok(Vec<PathBuf>)`: A vector of paths to all resources used in the document
    /// - `Err(EpubError)`: Error occurred during the making process
    pub fn make<P: AsRef<Path>>(&mut self, target: P) -> Result<Vec<PathBuf>, EpubError> {
        let mut result = Vec::new();

        // Handle target directory, create if it doesn't exist
        let target_dir = match target.as_ref().parent() {
            Some(path) => {
                fs::create_dir_all(path)?;
                path.to_path_buf()
            }
            None => {
                return Err(EpubBuilderError::InvalidTargetPath {
                    target_path: target.as_ref().to_string_lossy().to_string(),
                }
                .into());
            }
        };

        self.make_content(&target)?;
        result.push(target.as_ref().to_path_buf());

        // Copy all resource files (images, audio, video) from temp directory to target directory
        for resource_type in ["img", "audio", "video", "css"] {
            let source = self.temp_dir.join(resource_type);
            if !source.is_dir() {
                continue;
            }

            let target = target_dir.join(resource_type);
            fs::create_dir_all(&target)?;

            for entry in WalkDir::new(&source)
                .min_depth(1)
                .into_iter()
                .filter_map(|result| result.ok())
                .filter(|entry| entry.file_type().is_file())
            {
                let file_name = entry.file_name();
                let target = target.join(file_name);

                fs::copy(entry.path(), &target)?;
                result.push(target);
            }
        }

        Ok(result)
    }

    /// Write the document to a file
    ///
    /// Constructs the final XHTML document from all added blocks and writes it to the specified output path.
    ///
    /// ## Parameters
    /// - `target_path`: The file path where the XHTML document should be written
    fn make_content<P: AsRef<Path>>(&mut self, target_path: P) -> Result<(), EpubError> {
        let mut writer = Writer::new(Cursor::new(Vec::new()));

        writer.write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))?;
        writer.write_event(Event::Start(BytesStart::new("html").with_attributes([
            ("xmlns", "http://www.w3.org/1999/xhtml"),
            ("xml:lang", self.language.as_str()),
        ])))?;

        // make head
        writer.write_event(Event::Start(BytesStart::new("head")))?;
        writer.write_event(Event::Start(BytesStart::new("title")))?;
        writer.write_event(Event::Text(BytesText::new(&self.title)))?;
        writer.write_event(Event::End(BytesEnd::new("title")))?;

        if self.css_files.is_empty() {
            self.make_style(&mut writer)?;
        } else {
            for css_file in self.css_files.iter() {
                // we can assert that this path target to a file, so unwrap is safe here
                let file_name = css_file.file_name().unwrap().to_string_lossy().to_string();

                writer.write_event(Event::Empty(BytesStart::new("link").with_attributes([
                    ("href", format!("./css/{}", file_name).as_str()),
                    ("rel", "stylesheet"),
                    ("type", "text/css"),
                ])))?;
            }
        }

        writer.write_event(Event::End(BytesEnd::new("head")))?;

        // make body
        writer.write_event(Event::Start(BytesStart::new("body")))?;
        writer.write_event(Event::Start(BytesStart::new("main")))?;

        let mut footnote_index = 1;
        let mut footnotes = Vec::new();
        for block in self.blocks.iter_mut() {
            block.make(&mut writer, footnote_index)?;

            footnotes.append(&mut block.take_footnotes());
            footnote_index = footnotes.len() + 1;
        }

        writer.write_event(Event::End(BytesEnd::new("main")))?;

        Self::make_footnotes(&mut writer, footnotes)?;
        writer.write_event(Event::End(BytesEnd::new("body")))?;
        writer.write_event(Event::End(BytesEnd::new("html")))?;

        let file_path = PathBuf::from(target_path.as_ref());
        let file_data = writer.into_inner().into_inner();
        fs::write(file_path, file_data)?;

        Ok(())
    }

    /// Generates CSS styles for the document
    fn make_style(&self, writer: &mut XmlWriter) -> Result<(), EpubError> {
        let style = format!(
            r#"
            * {{
                margin: 0;
                padding: 0;
                font-family: {font_family};
                text-align: {text_align};
                background-color: {background};
                color: {text};
            }}
            body, p, div, span, li, td, th {{
                font-size: {font_size}rem;
                line-height: {line_height}em;
                font-weight: {font_weight};
                font-style: {font_style};
                letter-spacing: {letter_spacing};
            }}
            body {{ margin: {margin}px; }}
            p {{ text-indent: {text_indent}em; }}
            a {{ color: {link_color}; text-decoration: none; }}
            figcaption {{ text-align: center; line-height: 1em; }}
            blockquote {{ padding: 1em 2em; }}
            blockquote > p {{ font-style: italic; }}
            .content-block {{ margin-bottom: {paragraph_spacing}px; }}
            .image-block > img,
            .audio-block > audio,
            .video-block > video {{ width: 100%; }}
            .footnote-ref {{ font-size: 0.5em; vertical-align: super; }}
            .footnote-list {{ list-style: none; padding: 0; }}
            .footnote-item > p {{ text-indent: 0; }}
            "#,
            font_family = self.styles.text.font_family,
            text_align = self.styles.layout.text_align,
            background = self.styles.color_scheme.background,
            text = self.styles.color_scheme.text,
            font_size = self.styles.text.font_size,
            line_height = self.styles.text.line_height,
            font_weight = self.styles.text.font_weight,
            font_style = self.styles.text.font_style,
            letter_spacing = self.styles.text.letter_spacing,
            margin = self.styles.layout.margin,
            text_indent = self.styles.text.text_indent,
            link_color = self.styles.color_scheme.link,
            paragraph_spacing = self.styles.layout.paragraph_spacing,
        );

        writer.write_event(Event::Start(BytesStart::new("style")))?;
        writer.write_event(Event::Text(BytesText::new(&style)))?;
        writer.write_event(Event::End(BytesEnd::new("style")))?;

        Ok(())
    }

    /// Generates the footnotes section in the document
    ///
    /// Creates an aside element containing an unordered list of all footnotes.
    /// Each footnote is rendered as a list item with a backlink to its reference in the text.
    fn make_footnotes(writer: &mut XmlWriter, footnotes: Vec<Footnote>) -> Result<(), EpubError> {
        writer.write_event(Event::Start(BytesStart::new("aside")))?;
        writer.write_event(Event::Start(
            BytesStart::new("ul").with_attributes([("class", "footnote-list")]),
        ))?;

        let mut index = 1;
        for footnote in footnotes.into_iter() {
            writer.write_event(Event::Start(BytesStart::new("li").with_attributes([
                ("id", format!("footnote-{}", index).as_str()),
                ("class", "footnote-item"),
            ])))?;
            writer.write_event(Event::Start(BytesStart::new("p")))?;

            writer.write_event(Event::Start(
                BytesStart::new("a")
                    .with_attributes([("href", format!("#ref-{}", index).as_str())]),
            ))?;
            writer.write_event(Event::Text(BytesText::new(&format!("[{}]", index,))))?;
            writer.write_event(Event::End(BytesEnd::new("a")))?;
            writer.write_event(Event::Text(BytesText::new(&footnote.content)))?;

            writer.write_event(Event::End(BytesEnd::new("p")))?;
            writer.write_event(Event::End(BytesEnd::new("li")))?;

            index += 1;
        }

        writer.write_event(Event::End(BytesEnd::new("ul")))?;
        writer.write_event(Event::End(BytesEnd::new("aside")))?;

        Ok(())
    }

    /// Automatically handles media resources
    ///
    /// Copies media files (images, audio, video) from their original locations
    /// to the temporary directory for inclusion in the EPUB package.
    fn handle_resource(&mut self) -> Result<(), EpubError> {
        match self.blocks.last() {
            Some(Block::Image { url, .. }) => self.copy_to_temp(url, "img")?,

            Some(Block::Video { url, .. }) => self.copy_to_temp(url, "video")?,

            Some(Block::Audio { url, .. }) => self.copy_to_temp(url, "audio")?,

            Some(Block::MathML { fallback_image: Some(url), .. }) => {
                self.copy_to_temp(url, "img")?
            }

            _ => {}
        }

        Ok(())
    }

    #[inline]
    fn copy_to_temp(&self, source: impl AsRef<Path>, resource_type: &str) -> Result<(), EpubError> {
        let target_dir = self.temp_dir.join(resource_type);
        fs::create_dir_all(&target_dir)?;

        let source = source.as_ref();
        let target_path = target_dir.join(source.file_name().unwrap());

        fs::copy(source, &target_path)?;
        Ok(())
    }
}

impl Drop for ContentBuilder {
    fn drop(&mut self) {
        if let Err(err) = fs::remove_dir_all(&self.temp_dir) {
            warn!("{}", err);
        };
    }
}

#[cfg(test)]
mod tests {
    mod block_builder_tests {
        use std::path::PathBuf;

        use crate::{
            builder::content::{Block, BlockBuilder},
            error::{EpubBuilderError, EpubError},
            types::{BlockType, Footnote},
        };

        #[test]
        fn test_create_text_block() {
            let mut builder = BlockBuilder::new(BlockType::Text);
            builder.set_content("Hello, World!");

            let block = builder.try_into();
            assert!(block.is_ok());

            let block = block.unwrap();
            match block {
                Block::Text { content, footnotes } => {
                    assert_eq!(content, "Hello, World!");
                    assert!(footnotes.is_empty());
                }
                _ => unreachable!(),
            }
        }

        #[test]
        fn test_create_text_block_missing_content() {
            let builder = BlockBuilder::new(BlockType::Text);

            let block: Result<Block, EpubError> = builder.try_into();
            assert!(block.is_err());

            let result = block.unwrap_err();
            assert_eq!(
                result,
                EpubBuilderError::MissingNecessaryBlockData {
                    block_type: "Text".to_string(),
                    missing_data: "'content'".to_string()
                }
                .into()
            )
        }

        #[test]
        fn test_create_quote_block() {
            let mut builder = BlockBuilder::new(BlockType::Quote);
            builder.set_content("To be or not to be");

            let block: Result<Block, EpubError> = builder.try_into();
            assert!(block.is_ok());

            let block = block.unwrap();
            match block {
                Block::Quote { content, footnotes } => {
                    assert_eq!(content, "To be or not to be");
                    assert!(footnotes.is_empty());
                }
                _ => unreachable!(),
            }
        }

        #[test]
        fn test_create_title_block() {
            let mut builder = BlockBuilder::new(BlockType::Title);
            builder.set_content("Chapter 1").set_title_level(2);

            let block: Result<Block, EpubError> = builder.try_into();
            assert!(block.is_ok());

            let block = block.unwrap();
            match block {
                Block::Title { content, level, footnotes } => {
                    assert_eq!(content, "Chapter 1");
                    assert_eq!(level, 2);
                    assert!(footnotes.is_empty());
                }
                _ => unreachable!(),
            }
        }

        #[test]
        fn test_create_title_block_invalid_level() {
            let mut builder = BlockBuilder::new(BlockType::Title);
            builder.set_content("Chapter 1").set_title_level(10);

            let result: Result<Block, EpubError> = builder.try_into();
            assert!(result.is_err());

            let result = result.unwrap_err();
            assert_eq!(
                result,
                EpubBuilderError::MissingNecessaryBlockData {
                    block_type: "Title".to_string(),
                    missing_data: "'level'".to_string(),
                }
                .into()
            );
        }

        #[test]
        fn test_create_image_block() {
            let img_path = PathBuf::from("./test_case/image.jpg");
            let mut builder = BlockBuilder::new(BlockType::Image);
            builder
                .set_url(&img_path)
                .unwrap()
                .set_alt("Test Image")
                .set_caption("A test image");

            let block: Result<Block, EpubError> = builder.try_into();
            assert!(block.is_ok());

            let block = block.unwrap();
            match block {
                Block::Image { url, alt, caption, footnotes } => {
                    assert_eq!(url.file_name().unwrap(), "image.jpg");
                    assert_eq!(alt, Some("Test Image".to_string()));
                    assert_eq!(caption, Some("A test image".to_string()));
                    assert!(footnotes.is_empty());
                }
                _ => unreachable!(),
            }
        }

        #[test]
        fn test_create_image_block_missing_url() {
            let builder = BlockBuilder::new(BlockType::Image);

            let block: Result<Block, EpubError> = builder.try_into();
            assert!(block.is_err());

            let result = block.unwrap_err();
            assert_eq!(
                result,
                EpubBuilderError::MissingNecessaryBlockData {
                    block_type: "Image".to_string(),
                    missing_data: "'url'".to_string(),
                }
                .into()
            );
        }

        #[test]
        fn test_create_audio_block() {
            let audio_path = PathBuf::from("./test_case/audio.mp3");
            let mut builder = BlockBuilder::new(BlockType::Audio);
            builder
                .set_url(&audio_path)
                .unwrap()
                .set_fallback("Audio not supported")
                .set_caption("Background music");

            let block = builder.try_into();
            assert!(block.is_ok());

            let block = block.unwrap();
            match block {
                Block::Audio { url, fallback, caption, footnotes } => {
                    assert_eq!(url.file_name().unwrap(), "audio.mp3");
                    assert_eq!(fallback, "Audio not supported");
                    assert_eq!(caption, Some("Background music".to_string()));
                    assert!(footnotes.is_empty());
                }
                _ => unreachable!(),
            }
        }

        #[test]
        fn test_set_url_invalid_file_type() {
            let xhtml_path = PathBuf::from("./test_case/Overview.xhtml");
            let mut builder = BlockBuilder::new(BlockType::Image);
            let result = builder.set_url(&xhtml_path);
            assert!(result.is_err());

            let err = result.unwrap_err();
            assert_eq!(err, EpubBuilderError::NotExpectedFileFormat.into());
        }

        #[test]
        fn test_set_url_nonexistent_file() {
            let nonexistent_path = PathBuf::from("./test_case/nonexistent.jpg");
            let mut builder = BlockBuilder::new(BlockType::Image);
            let result = builder.set_url(&nonexistent_path);
            assert!(result.is_err());

            let err = result.unwrap_err();
            assert_eq!(
                err,
                EpubBuilderError::TargetIsNotFile {
                    target_path: "./test_case/nonexistent.jpg".to_string()
                }
                .into()
            );
        }

        #[test]
        fn test_set_fallback_image_invalid_type() {
            let audio_path = PathBuf::from("./test_case/audio.mp3");
            let mut builder = BlockBuilder::new(BlockType::MathML);
            builder.set_mathml_element("<math/>");
            let result = builder.set_fallback_image(audio_path);
            assert!(result.is_err());

            let err = result.unwrap_err();
            assert_eq!(err, EpubBuilderError::NotExpectedFileFormat.into());
        }

        #[test]
        fn test_set_fallback_image_nonexistent() {
            let nonexistent_path = PathBuf::from("./test_case/nonexistent.png");
            let mut builder = BlockBuilder::new(BlockType::MathML);
            builder.set_mathml_element("<math/>");
            let result = builder.set_fallback_image(nonexistent_path);
            assert!(result.is_err());

            let err = result.unwrap_err();
            assert_eq!(
                err,
                EpubBuilderError::TargetIsNotFile {
                    target_path: "./test_case/nonexistent.png".to_string()
                }
                .into()
            );
        }

        #[test]
        fn test_create_video_block() {
            let video_path = PathBuf::from("./test_case/video.mp4");
            let mut builder = BlockBuilder::new(BlockType::Video);
            builder
                .set_url(&video_path)
                .unwrap()
                .set_fallback("Video not supported")
                .set_caption("Demo video");

            let block = builder.try_into();
            assert!(block.is_ok());

            let block = block.unwrap();
            match block {
                Block::Video { url, fallback, caption, footnotes } => {
                    assert_eq!(url.file_name().unwrap(), "video.mp4");
                    assert_eq!(fallback, "Video not supported");
                    assert_eq!(caption, Some("Demo video".to_string()));
                    assert!(footnotes.is_empty());
                }
                _ => unreachable!(),
            }
        }

        #[test]
        fn test_create_mathml_block() {
            let mathml_content = r#"<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi>x</mi><mo>=</mo><mn>1</mn></mrow></math>"#;
            let mut builder = BlockBuilder::new(BlockType::MathML);
            builder
                .set_mathml_element(mathml_content)
                .set_caption("Simple equation");

            let block = builder.try_into();
            assert!(block.is_ok());

            let block = block.unwrap();
            match block {
                Block::MathML {
                    element_str,
                    fallback_image,
                    caption,
                    footnotes,
                } => {
                    assert_eq!(element_str, mathml_content);
                    assert!(fallback_image.is_none());
                    assert_eq!(caption, Some("Simple equation".to_string()));
                    assert!(footnotes.is_empty());
                }
                _ => unreachable!(),
            }
        }

        #[test]
        fn test_create_mathml_block_with_fallback() {
            let img_path = PathBuf::from("./test_case/image.jpg");
            let mathml_content = r#"<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi>x</mi></mrow></math>"#;

            let mut builder = BlockBuilder::new(BlockType::MathML);
            builder
                .set_mathml_element(mathml_content)
                .set_fallback_image(img_path.clone())
                .unwrap();

            let block = builder.try_into();
            assert!(block.is_ok());

            let block = block.unwrap();
            match block {
                Block::MathML { element_str, fallback_image, .. } => {
                    assert_eq!(element_str, mathml_content);
                    assert!(fallback_image.is_some());
                }
                _ => unreachable!(),
            }
        }

        #[test]
        fn test_footnote_management() {
            let mut builder = BlockBuilder::new(BlockType::Text);
            builder.set_content("This is a test");

            let note1 = Footnote {
                locate: 5,
                content: "First footnote".to_string(),
            };
            let note2 = Footnote {
                locate: 10,
                content: "Second footnote".to_string(),
            };

            builder.add_footnote(note1).add_footnote(note2);

            let block = builder.try_into();
            assert!(block.is_ok());

            let block = block.unwrap();
            match block {
                Block::Text { footnotes, .. } => {
                    assert_eq!(footnotes.len(), 2);
                }
                _ => unreachable!(),
            }
        }

        #[test]
        fn test_invalid_footnote_locate() {
            let mut builder = BlockBuilder::new(BlockType::Text);
            builder.set_content("Hello");

            // Footnote locate exceeds content length
            builder.add_footnote(Footnote {
                locate: 100,
                content: "Invalid footnote".to_string(),
            });

            let result: Result<Block, EpubError> = builder.try_into();
            assert!(result.is_err());

            let result = result.unwrap_err();
            assert_eq!(
                result,
                EpubBuilderError::InvalidFootnoteLocate { max_locate: 5 }.into()
            );
        }

        #[test]
        fn test_footnote_on_media_without_caption() {
            let img_path = PathBuf::from("./test_case/image.jpg");
            let mut builder = BlockBuilder::new(BlockType::Image);
            builder.set_url(&img_path).unwrap();

            builder.add_footnote(Footnote { locate: 1, content: "Note".to_string() });

            let result: Result<Block, EpubError> = builder.try_into();
            assert!(result.is_err());

            let result = result.unwrap_err();
            assert_eq!(
                result,
                EpubBuilderError::InvalidFootnoteLocate { max_locate: 0 }.into()
            );
        }
    }

    mod content_builder_tests {
        use std::{env, fs, path::PathBuf};

        use crate::{
            builder::content::ContentBuilder,
            types::{ColorScheme, Footnote, PageLayout, TextAlign, TextStyle},
            utils::local_time,
        };

        #[test]
        fn test_create_content_builder() {
            let builder = ContentBuilder::new("chapter1", "en");
            assert!(builder.is_ok());

            let builder = builder.unwrap();
            assert_eq!(builder.id, "chapter1");
        }

        #[test]
        fn test_set_title() {
            let builder = ContentBuilder::new("chapter1", "en");
            assert!(builder.is_ok());

            let mut builder = builder.unwrap();
            builder.set_title("My Chapter").set_title("Another Title");

            assert_eq!(builder.title, "Another Title");
        }

        #[test]
        fn test_add_text_block() {
            let builder = ContentBuilder::new("chapter1", "en");
            assert!(builder.is_ok());

            let mut builder = builder.unwrap();
            let result = builder.add_text_block("This is a paragraph", vec![]);
            assert!(result.is_ok());
        }

        #[test]
        fn test_add_quote_block() {
            let builder = ContentBuilder::new("chapter1", "en");
            assert!(builder.is_ok());

            let mut builder = builder.unwrap();
            let result = builder.add_quote_block("A quoted text", vec![]);
            assert!(result.is_ok());
        }

        #[test]
        fn test_set_styles() {
            let builder = ContentBuilder::new("chapter1", "en");
            assert!(builder.is_ok());

            let custom_styles = crate::types::StyleOptions {
                text: TextStyle {
                    font_size: 1.5,
                    line_height: 1.8,
                    font_family: "Georgia, serif".to_string(),
                    font_weight: "bold".to_string(),
                    font_style: "italic".to_string(),
                    letter_spacing: "0.1em".to_string(),
                    text_indent: 1.5,
                },
                color_scheme: ColorScheme {
                    background: "#F5F5F5".to_string(),
                    text: "#333333".to_string(),
                    link: "#0066CC".to_string(),
                },
                layout: PageLayout {
                    margin: 30,
                    text_align: TextAlign::Center,
                    paragraph_spacing: 20,
                },
            };

            let mut builder = builder.unwrap();
            builder.set_styles(custom_styles);

            assert_eq!(builder.styles.text.font_size, 1.5);
            assert_eq!(builder.styles.text.font_weight, "bold");
            assert_eq!(builder.styles.color_scheme.background, "#F5F5F5");
            assert_eq!(builder.styles.layout.text_align, TextAlign::Center);
        }

        #[test]
        fn test_add_title_block() {
            let builder = ContentBuilder::new("chapter1", "en");
            assert!(builder.is_ok());

            let mut builder = builder.unwrap();
            let result = builder.add_title_block("Section Title", 2, vec![]);
            assert!(result.is_ok());
        }

        #[test]
        fn test_add_image_block() {
            let img_path = PathBuf::from("./test_case/image.jpg");
            let builder = ContentBuilder::new("chapter1", "en");
            assert!(builder.is_ok());

            let mut builder = builder.unwrap();
            let result = builder.add_image_block(
                img_path,
                Some("Alt text".to_string()),
                Some("Figure 1: An image".to_string()),
                vec![],
            );

            assert!(result.is_ok());
        }

        #[test]
        fn test_add_audio_block() {
            let audio_path = PathBuf::from("./test_case/audio.mp3");
            let builder = ContentBuilder::new("chapter1", "en");
            assert!(builder.is_ok());

            let mut builder = builder.unwrap();
            let result = builder.add_audio_block(
                audio_path,
                "Your browser doesn't support audio".to_string(),
                Some("Background music".to_string()),
                vec![],
            );

            assert!(result.is_ok());
        }

        #[test]
        fn test_add_video_block() {
            let video_path = PathBuf::from("./test_case/video.mp4");
            let builder = ContentBuilder::new("chapter1", "en");
            assert!(builder.is_ok());

            let mut builder = builder.unwrap();
            let result = builder.add_video_block(
                video_path,
                "Your browser doesn't support video".to_string(),
                Some("Tutorial video".to_string()),
                vec![],
            );

            assert!(result.is_ok());
        }

        #[test]
        fn test_add_mathml_block() {
            let mathml = r#"<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi>x</mi></mrow></math>"#;
            let builder = ContentBuilder::new("chapter1", "en");
            assert!(builder.is_ok());

            let mut builder = builder.unwrap();
            let result = builder.add_mathml_block(
                mathml.to_string(),
                None,
                Some("Equation 1".to_string()),
                vec![],
            );

            assert!(result.is_ok());
        }

        #[test]
        fn test_make_content_document() {
            let temp_dir = env::temp_dir().join(local_time());
            assert!(fs::create_dir_all(&temp_dir).is_ok());

            let output_path = temp_dir.join("chapter.xhtml");

            let builder = ContentBuilder::new("chapter1", "en");
            assert!(builder.is_ok());

            let mut builder = builder.unwrap();
            builder
                .set_title("My Chapter")
                .add_text_block("This is the first paragraph.", vec![])
                .unwrap()
                .add_text_block("This is the second paragraph.", vec![])
                .unwrap();

            let result = builder.make(&output_path);
            assert!(result.is_ok());
            assert!(output_path.exists());
            assert!(fs::remove_dir_all(temp_dir).is_ok());
        }

        #[test]
        fn test_make_content_with_media() {
            let temp_dir = env::temp_dir().join(local_time());
            assert!(fs::create_dir_all(&temp_dir).is_ok());

            let output_path = temp_dir.join("chapter.xhtml");
            let img_path = PathBuf::from("./test_case/image.jpg");

            let builder = ContentBuilder::new("chapter1", "en");
            assert!(builder.is_ok());

            let mut builder = builder.unwrap();
            builder
                .set_title("Chapter with Media")
                .add_text_block("See image below:", vec![])
                .unwrap()
                .add_image_block(
                    img_path,
                    Some("Test".to_string()),
                    Some("Figure 1".to_string()),
                    vec![],
                )
                .unwrap();

            let result = builder.make(&output_path);
            assert!(result.is_ok());

            let img_dir = temp_dir.join("img");
            assert!(img_dir.exists());
            assert!(fs::remove_dir_all(&temp_dir).is_ok());
        }

        #[test]
        fn test_make_content_with_footnotes() {
            let temp_dir = env::temp_dir().join(local_time());
            assert!(fs::create_dir_all(&temp_dir).is_ok());

            let output_path = temp_dir.join("chapter.xhtml");

            let footnotes = vec![
                Footnote {
                    locate: 10,
                    content: "This is a footnote".to_string(),
                },
                Footnote {
                    locate: 15,
                    content: "Another footnote".to_string(),
                },
            ];

            let builder = ContentBuilder::new("chapter1", "en");
            assert!(builder.is_ok());

            let mut builder = builder.unwrap();
            builder
                .set_title("Chapter with Notes")
                .add_text_block("This is a paragraph with notes.", footnotes)
                .unwrap();

            let result = builder.make(&output_path);
            assert!(result.is_ok());
            assert!(output_path.exists());
            assert!(fs::remove_dir_all(&temp_dir).is_ok());
        }

        #[test]
        fn test_add_css_file() {
            let builder = ContentBuilder::new("chapter1", "en");
            assert!(builder.is_ok());

            let mut builder = builder.unwrap();
            let result = builder.add_css_file(PathBuf::from("./test_case/style.css"));

            assert!(result.is_ok());
            assert_eq!(builder.css_files.len(), 1);
        }

        #[test]
        fn test_add_css_file_nonexistent() {
            let builder = ContentBuilder::new("chapter1", "en");
            assert!(builder.is_ok());

            let mut builder = builder.unwrap();
            let result = builder.add_css_file(PathBuf::from("nonexistent.css"));
            assert!(result.is_err());
        }

        #[test]
        fn test_add_multiple_css_files() {
            let temp_dir = env::temp_dir().join(local_time());
            assert!(fs::create_dir_all(&temp_dir).is_ok());

            let css_path1 = temp_dir.join("style1.css");
            let css_path2 = temp_dir.join("style2.css");
            assert!(fs::write(&css_path1, "body { color: red; }").is_ok());
            assert!(fs::write(&css_path2, "p { font-size: 16px; }").is_ok());

            let builder = ContentBuilder::new("chapter1", "en");
            assert!(builder.is_ok());

            let mut builder = builder.unwrap();
            assert!(builder.add_css_file(css_path1).is_ok());
            assert!(builder.add_css_file(css_path2).is_ok());

            assert_eq!(builder.css_files.len(), 2);

            assert!(fs::remove_dir_all(&temp_dir).is_ok());
        }
    }

    mod block_tests {
        use std::path::PathBuf;

        use crate::{builder::content::Block, types::Footnote};

        #[test]
        fn test_take_footnotes_from_text_block() {
            let footnotes = vec![Footnote { locate: 5, content: "Note".to_string() }];

            let block = Block::Text {
                content: "Hello world".to_string(),
                footnotes: footnotes.clone(),
            };

            let taken = block.take_footnotes();
            assert_eq!(taken.len(), 1);
            assert_eq!(taken[0].content, "Note");
        }

        #[test]
        fn test_take_footnotes_from_quote_block() {
            let footnotes = vec![
                Footnote { locate: 3, content: "First".to_string() },
                Footnote { locate: 8, content: "Second".to_string() },
            ];

            let block = Block::Quote {
                content: "Test quote".to_string(),
                footnotes: footnotes.clone(),
            };

            let taken = block.take_footnotes();
            assert_eq!(taken.len(), 2);
        }

        #[test]
        fn test_take_footnotes_from_image_block() {
            let img_path = PathBuf::from("test.png");
            let footnotes = vec![Footnote {
                locate: 2,
                content: "Image note".to_string(),
            }];

            let block = Block::Image {
                url: img_path,
                alt: None,
                caption: Some("A caption".to_string()),
                footnotes: footnotes.clone(),
            };

            let taken = block.take_footnotes();
            assert_eq!(taken.len(), 1);
        }

        #[test]
        fn test_block_with_empty_footnotes() {
            let block = Block::Text {
                content: "No footnotes here".to_string(),
                footnotes: vec![],
            };

            let taken = block.take_footnotes();
            assert!(taken.is_empty());
        }
    }

    mod content_rendering_tests {
        use crate::builder::content::Block;

        #[test]
        fn test_split_content_by_index_empty() {
            let result = Block::split_content_by_index("Hello", &[]);
            assert_eq!(result, vec!["Hello"]);
        }

        #[test]
        fn test_split_content_by_single_index() {
            let result = Block::split_content_by_index("Hello World", &[5]);
            assert_eq!(result.len(), 2);
            assert_eq!(result[0], "Hello");
            assert_eq!(result[1], " World");
        }

        #[test]
        fn test_split_content_by_multiple_indices() {
            let result = Block::split_content_by_index("One Two Three", &[3, 7]);
            assert_eq!(result.len(), 3);
            assert_eq!(result[0], "One");
            assert_eq!(result[1], " Two");
            assert_eq!(result[2], " Three");
        }

        #[test]
        fn test_split_content_unicode() {
            let content = "你好世界";
            let result = Block::split_content_by_index(content, &[2]);
            assert_eq!(result.len(), 2);
            assert_eq!(result[0], "你好");
            assert_eq!(result[1], "世界");
        }
    }
}
