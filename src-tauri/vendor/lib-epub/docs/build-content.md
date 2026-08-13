# Guide to Building Content Documents

This guide details how to use the `content` module of `lib-epub`
to build EPUB content documents (XHTML files).

## Overview

The `content` module provides two main components:

- **`ContentBuilder`**: Builds complete XHTML content documents with multiple blocks
- **`BlockBuilder`**: Creates individual content blocks (text, images, audio, video, etc.)

## Quick Start

### Enabling the content-builder feature

Enable the `content-builder` feature in `Cargo.toml`.
This automatically enables the `builder` feature as well:

```toml
[dependencies]
lib-epub = { version = "0.3", features = ["content-builder"] }
```

### Minimalist Example

```rust
use lib_epub::{
    builder::content::{Block, BlockBuilder, ContentBuilder},
    types::{BlockType, Footnote},
};

fn main() -> Result<(), lib_epub::error::EpubError> {
    let mut block_builder = BlockBuilder::new(BlockType::Title);
    block_builder
        .set_content("This is a title")
        .set_title_level(2)
        .add_footnote(Footnote {
            locate: 15,
            content: "This is a footnote.".to_string(),
        });

    let block = block_builder.try_into()?;

    let mut builder = ContentBuilder::new("chapter1", "zh-CN")?;
    builder.set_title("My Chapter")
        .add_block(block)?
        .add_text_block("This is my first chapter.", vec![])?;

    let _ = builder.make("output.xhtml")?;

    Ok(())
}
```

## Block and BlockBuilder Explained

### Text

Represents a paragraph of text.

```rust
BlockBuilder::new(BlockType::Text)
    .set_content("This is a paragraph.") // Required
    .add_footnote(footnote)              // Optional
    .try_into()?;
```

The final constructed block has the following structure:

```xhtml
<p class="content-block text-block">
  {{ text.content }}
</p>
```

### Quote

Represents a block quotation.

```rust
BlockBuilder::new(BlockType::Quote)
    .set_content("A famous quote.") // Required
    .try_into()?;
```

The final constructed block has the following structure:

```xhtml
<blockquote class="content-block quote-block">
  {{ quote.content }}
</blockquote>
```

### Title

Represents a heading with level (1-6).

```rust
BlockBuilder::new(BlockType::Title)
    .set_content("Chapter 1") // Required
    .set_title_level(1)       // Required (1-6)
    .try_into()?;
```

The final constructed block has the following structure:

```xhtml
<h1 class="content-block title-block">
  {{ title.content }}
</h1>
```

If the level is outside the valid range (1-6), the setting is silently ignored.

### Image

Contains an image with optional alt text and caption.

```rust
BlockBuilder::new(BlockType::Image)
    .set_url(&"photo.jpg".into()?)  // Required
    .set_alt("Photo description")   // Optional
    .set_caption("Photo caption")   // Optional
    .try_into()?;
```

The final constructed block has the following structure:

```xhtml
<figure class="content-block image-block">
  <img src="{{ image.url }}" alt="{{ image.alt }}" />
  <figcaption>
    {{ image.caption }}
  </figcaption>
</figure>
```

### Audio

Contains an audio player with fallback text.

```rust
BlockBuilder::new(BlockType::Audio)
    .set_url(&"audio.mp3".into()?)                          // Required
    .set_fallback("Your browser does not support audio.")   // Required
    .set_caption("Audio caption")                           // Optional
    .try_into()?;
```

The final constructed block has the following structure:

```xhtml
<figure class="content-block audio-block">
  <audio src="{{ audio.url }}" controls>
    <p>{{ audio.fallback }}</p>
  </audio>
  <figcaption>
    {{ audio.caption }}
  </figcaption>
</figure>
```

### Video

Contains a video player with fallback text.

```rust
BlockBuilder::new(BlockType::Video)
    .set_url(&"video.mp4".into()?)                          // Required
    .set_fallback("Your browser does not support video.")   // Required
    .set_caption("Video caption")                           // Optional
    .try_into()?;
```

The final constructed block has the following structure:

```xhtml
<figure class="content-block video-block">
  <video src="{{ video.url }}" controls>
    <p>{{ video.fallback }}</p>
  </video>
  <figcaption>
    {{ video.caption }}
  </figcaption>
</figure>
```

### MathML

Contains mathematical notation using MathML markup.

```rust
BlockBuilder::new(BlockType::MathML)
    .set_mathml_element("<math><mi>x</mi></math>")  // Required
    .set_fallback_image("formula.png".into())       // Optional
    .set_caption("Equation caption")                // Optional
    .try_into()?;
```

The final constructed block has the following structure:

```xhtml
<figure class="content-block mathml-block">
  {{ mathml.element_str as innerHTML }}
  <img src="{{ mathml.fallback_image }}" class="mathml-fallback" />
  <figcaption>
    {{ mathml.caption }}
  </figcaption>
</figure>
```

Notes:

- MathML markup is inserted directly without validation. Ensure the MathML is well-formed.
- The fallback image is displayed when the reading system doesn't support MathML.

### Footnotes

Footnotes can be added to any block type.
They are positioned by char offset within the block's content.

Footnotes will be used in different places for different types of blocks:

- For Text, Quote, and Title blocks: footnotes are associated with the block's content.
- For Image, Audio, Video, and MathML blocks: footnotes are associated with the block's
  caption (if present). Footnotes on media blocks require a caption to be set.

If the footnote's location exceeds the text character limit,
an error will be returned when building the block;
For Image, Audio, Video, and MathML blocks, adding a footnote
when the caption field is empty will also return an error during construction.

The final constructed block has the following structure:

```xhtml
<!-- In the main text:  -->
<p>
  This is a example footnote
  <a class="footnote-ref" id="ref-{{ index }}" href="#footnote-{{ index }}">
    [{{ index }}]
  </a>
</p>

<!-- In the aside section: -->
<aside>
  <ul class="footnote-list">
    <li id="footnote-{{ index }}" class="footnote-item">
      <p>
        <a href="#ref-{{ index }}">[{{ index }}]</a>
        {{ footnote.content }}
      </p>
    </li>
    <!-- and others item... -->
  </ul>
</aside>
```

## ContentBuilder Explained

`ContentBuilder` creates XHTML content documents by assembling multiple blocks together.

### Creating a ContentBuilder

```rust
let mut builder = ContentBuilder::new("document-id", "en-US")?;
```

Parameters:

- `id`: A unique identifier for this document within the EPUB
- `language`: The language code (e.g., "en", "zh-CN", "ja")

### Custom Content Style

ContentBuilder provides two ways to customize content styles:

1. You can achieve customization within a limited scope using StyleOptions.

   ```rust
   builder.set_style(
       StyleOptions {
           text: TextStyle::default()
               .with_font_size(1.2)
               .with_line_height(1.5)
               .build(),
           ..StyleOptions::default()
       }
   );
   ```

2. You can achieve more customized styles for the content by adding a CSS file.

   ```rust
   builder.add_css_file("path/to/style.css".into())?;
   ```

   In the [previous chapter](Block and BlockBuilder Explained), we defined
   the structure of different types of blocks, thus allowing for more granular
   styling of different blocks.

### Adding Blocks

There are two ways to add content to a document:

1. Using Convenience Methods
   Each block type has a dedicated quick creation method;
   simply provide the required data to create a block:

   ```rust
   // Text block
   builder.add_text_block("Paragraph content here.", vec![])?;

   // Image block
   builder.add_image_block(
       "path/to/image.jpg".into(),
       Some("Alt text".to_string()),
       Some("Image caption".to_string()),
       vec![],
   )?;
   ```

2. Using BlockBuilder Directly

   ```rust
   let mut block_builder = BlockBuilder::new(BlockType::Image);
   block_builder
       .set_url(&"image.jpg".into()?)
       .set_alt("Description of the image")
       .set_caption("Caption displayed below the image")
       .add_footnote(Footnote {
           locate: 5,
           content: "Footnote for the image.".to_string(),
       });

   let block = block_builder.try_into()?;
   builder.add_block(block)?;
   ```

### Notes

1. When using `Block::Title`, it's important to note that different levels of
   chapter titles should maintain a fixed title level, for example:

   For a chapter: "1.2.1 xxx", if it has a level 3, then all third-level headings should
   have the same level 3. If the following content mentions that "2.1.1 xxx" uses level 4,
   then undefined behavior(UB) may occur during the build process, resulting in the inability
   to build the expected results.

2. The first parameter `id` of `ContentBuilder::new()` needs to be unique in certain situations:
   - When creating an XHTML document using only `ContentBuilder`, `id` has no practical meaning.
   - When using `ContentBuilder` to build publication content in `EpubBuilder`,
     the `ContentBuilder`'s `id` will be used as the `manifest` id,
     therefore its uniqueness must be guaranteed.

### Generating the Document

Content creation is accomplished using the `make()`:

```rust
let resources = builder.make("output/chapter1.xhtml")?;
```
