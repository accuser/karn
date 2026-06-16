# karn-fmt

[![crates.io](https://img.shields.io/crates/v/karn-fmt.svg)](https://crates.io/crates/karn-fmt)
[![docs.rs](https://img.shields.io/docsrs/karn-fmt)](https://docs.rs/karn-fmt)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg)](#license)

The **formatter for the [Karn](https://github.com/accuser/karn) language**.
Given Karn source, it produces the one canonical formatting — comments and
layout-significant trivia preserved.

This is a thin, stable surface that re-exports the formatter implementation from
[`karnc::fmt`](https://crates.io/crates/karnc). The split exists so downstream
consumers — the [`karnc-lsp`](https://crates.io/crates/karn-lsp) language server
and third-party tools — can depend on a small crate without pulling in the full
compiler API. (The implementation lives next to the parser and AST because
formatting is fundamentally an AST walk over the compiler's own types.)

Most users format Karn through the CLI (`karnc fmt`) or format-on-save in the
editor, rather than depending on this crate directly. See
[Format your code with `karn-fmt`](https://github.com/accuser/karn/blob/main/docs/src/guides/editor-and-tooling/format.md).

## Use

```toml
[dependencies]
karn-fmt = "0.28"
```

```rust
use karn_fmt::{format_source, FormatOptions};

let pretty = format_source(source, &FormatOptions::default())?;
```

The public API is small:

- `format_source(source, options) -> Result<String, FormatError>`
- `FormatOptions` / `IndentStyle` — formatting configuration.
- `FormatError` — a parse error in the input (you cannot format what does not
  parse).

See the [API docs](https://docs.rs/karn-fmt) for details.

## License

Licensed under either of [Apache-2.0](https://github.com/accuser/karn/blob/main/LICENSE-APACHE) or
[MIT](https://github.com/accuser/karn/blob/main/LICENSE-MIT) at your option.
