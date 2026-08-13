# lib-epub

A Rust library for reading and manipulating EPUB eBook files.

This library provides complete EPUB file parsing functionality, supporting
EPUB 2 and EPUB 3 formats. It can extract metadata, access content files,
and handle encrypted resources. Furthermore, this library also provides a
convenient way to build epub files from a set of resources.

## NOTICE

This crate was refactored in version 0.2.0, resulting in significant changes
to the API in the builder module. Please upgrade with caution.

## Features

- Parse EPUB file structure and containers, extract metadata, access resource files.
- Automatic handle encrypted content.
- Optional EPUB build functionality via 'builder' feature.
- EPUB specification-compliant verification mechanism.

## Installation

Add this to your `Cargo.toml`:

```toml
[dependencies]
lib-epub = "0.3.0"
```

## Quick Start

### Reading an EPUB file

```rust
use lib_epub::{error::EpubError, epub::EpubDoc};

fn main() -> Result<(), EpubError> {
    // Open EPUB file
    let mut doc = EpubDoc::new("path/to/epub/file.epub")?;

    // Get metadata
    println!("Title: {:?}", doc.get_title());
    println!("Creator: {:?}", doc.get_metadata_value("creator")?);

    // Read content
    let (_content, _mime) = doc.spine_current()?;
    let (_content, _mime) = doc.next_spine()?;

    Ok(())
}
```

### Building an EPUB file

```rust
use lib_epub::{
    builder::{EpubBuilder, EpubVersion3},
    error::EpubError,
    types::{MetadataItem, ManifestItem, NavPoint, SpineItem},
};

fn main() -> Result<(), EpubError> {
    let mut builder = EpubBuilder::<EpubVersion3>::new()?;

    builder
        .rootfile()
        .add("EPUB/content.opf")?;

    builder
        .metadata()
        .add(MetadataItem::new("title", "Test Book"))
        .add(MetadataItem::new("language", "en"))
        .add(
            MetadataItem::new("identifier", "unique-id")
                .with_id("pub-id")
                .build(),
        );

    builder
        .manifest()
        .add(
            "./test_case/Overview.xhtml",
            ManifestItem::new("content", "target/path")?,
        )?;

    builder
        .spine()
        .add(SpineItem::new("content"));

    builder
        .catalog()
        .set_title("Catalog Title")
        .add(NavPoint::new("label"));

    builder.build("output.epub")?;

    Ok(())
}
```

For more guides, please see [build epub guides](./docs/build-epub.md).

### Building an content document

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

For more guides, please see [build content guides](./docs/build-content.md).

## MSRV

The minimum supported Rust version is 1.85.0.

## More information

- Documentation: https://docs.rs/lib-epub
- Crate: https://crates.io/crates/lib-epub

## License

This project is licensed under the MIT License.
