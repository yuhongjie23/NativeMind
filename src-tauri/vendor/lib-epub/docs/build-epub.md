# Guide to Building EPUB Files

This guide details how to use the `builder` module of `lib-epub` to build EPUB files.

## Quick Start

### Enabling the builder feature

Enable the `builder` feature in `Cargo.toml`:

```toml
[dependencies]
lib-epub = { version = "0.3", features = ["builder"] }
```

### Minimalist Example

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

## EpubBuilder Explained

```rust
let mut builder = EpubBuilder::<EpubVersion3>::new()?;
```

EpubBuilder provides a fluent API that organizes the build process through method chaining.

`EpubVersion3` indicates building EPUB 3.0 format documents.
(Building EPUB 2.0 format documentation is under development.)

### Metadata

There are three methods for adding metadata, and these methods can be used in combination.

```rust
// 1. Chained syntax
builder
    .metadata()
    .add(MetadataItem::new("title", "My Book"))
    .add(MetadataItem::new("language", "zh-CN"))
    .add(
        MetadataItem::new("identifier", "urn:uuid:unique-id")
            .with_id("pub-id")
            .build(),
    );

// 2. Shorthand
builder.add_metadata("title", "我的书");

// 3. Transformation via MetadataSheet
builder
    .metadata()
    .from(a_metadata_sheet_instance);
```

Note that the following must be included before the final Epub document is built:

- At least one `title`
- At least one `language`
- At least one `identifier` with an `id` of `pub-id`

If these necessary metadata are missing, the build process will return an error.

### Manifest

The Manifest declares all resource files in the EPUB, including not only all XHTML files
that form the content body, but also all resources referenced in the XHTML files
(such as images, CSS, fonts, etc.).

Failure to provide a complete manifest of publication resources may lead to rendering issues.
Reading systems might not unzip such resources or could prevent access to them for security reasons.

Each item in the Manifest needs a unique ID for identification.
If duplicate IDs exist, later-added resources will overwrite previously added resources.

There are two ways to add a Manifest, and these two methods can be used in combination.

```rust
// 1. Chained syntax
builder
    .manifest()
    .add(
        "./test_case/Overview.xhtml",
        ManifestItem::new("overview", "EPUB/overview.xhtml")?,
    )?;

// 2. Shorthand
builder.add_manifest(
    "./image.svg",
    ManifestItem::new("image-svg", "EPUB/images/image.svg")?
)?;
```

The EPUB specification supports multimedia resources such as audio and images.
The main supported types (Core media types) include:

- Image: `image/jpeg`, `image/png`, `image/svg+xml`, `image/gif`, `image/webp`
- Audio: `audio/mpeg`, `audio/ogg`, `audio/mp4`
- Style: `text/css`
- Font: `font/ttf`, `font/otf`, `font/woff`, `font/woff`, `application/font-sfnt`,
  `application/vnd.ms-opentype`, `applifation/font-woff`
- Other: `application/xhtml+xml`, `application/javascript`, `application/ecmascript`,
  `text/javascript`, `application/x-dtbncx+xml`, `application/smil+xml`

For non-core media types, the specification allows the addition of these types,
but does not guarantee that all reading systems will support them.

### Spine

A Spine defines the reading order of content, referring to how the reading system
should load these resources when a user reads an EPUB publication.

Each item (itemref) in a Spine needs a unique idref attribute for identification.
The value of idref must match the id attribute value of an item in the Manifest
and cannot be reused in the Spine.

There are two ways to add a Spine, and these two methods can be used in combination.

```rust
// 1. Chained syntax
builder
    .spine()
    .add(SpineItem::new("chapter1"));

// 2. Shorthand
builder.add_spine(SpineItem::new("chapter2"));
```

By default, each item in a Spine is considered linear,
meaning it represents content that the user must access during reading.
You can also use the `set_linear()` method in `SpineItem` to mark an item as non-linear,
indicating that it is optional content and users can choose whether to access it.

### Navigation Document

The catalog defines the structured navigation information for EPUB publications.
This information is typically organized in a tree structure to help users quickly
locate specific chapters or sections.

Catalog-related data is organized into an XHTML file during the final EPUB file build
and registered in the Manifest.This resource has a `nav` property, and this property
must be unique across all resources; duplicates will return an error during the build process.

There are two ways to add a catalog, and these two methods can be used in combination.

```rust
// 1. Chained syntax
builder
    .catalog()
    .set_title("Table of Contents")
    .add(NavPoint::new("Chapter 1"))
    .add(NavPoint::new("Chapter 2"));

// 2. Shorthand
builder
    .set_catalog_title("Table of Contents")
    .add_catalog_item(NavPoint::new("Chapter 1"))
    .add_catalog_item(NavPoint::new("Chapter 2"));
```

### Build Methods

|    Method     |                                 Function                                  |
| :-----------: | :-----------------------------------------------------------------------: |
| `make(path)`  |             Generates an EPUB file at the specified location              |
| `build(path)` | Generates an EPUB file at the specified location and returns an `EpubDoc` |
