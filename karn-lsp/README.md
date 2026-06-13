# karn-lsp

[![crates.io](https://img.shields.io/crates/v/karn-lsp.svg)](https://crates.io/crates/karn-lsp)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg)](#license)

The **Language Server for the [Karn](https://github.com/accuser/karn)
language**. The crate builds the `karnc-lsp` binary, which any LSP-capable
editor can speak to for live diagnostics, navigation, and refactoring of `.karn`
projects.

Built on [`tower-lsp`](https://crates.io/crates/tower-lsp), it shares the
compiler ([`karnc`](https://crates.io/crates/karnc)) and formatter
([`karn-fmt`](https://crates.io/crates/karn-fmt)) with the CLI, so the editor
sees exactly the diagnostics `karnc check` would report.

## Capabilities

- **Diagnostics** — re-runs the compiler on change and publishes errors and
  warnings with their dotted categories.
- **Hover** — type signatures and doc blocks.
- **Go-to-definition** and **find references** for types, functions,
  capabilities, services, and agents.
- **Rename** (workspace-wide, validated).
- **Formatting** and **range formatting** (via `karn-fmt`).
- **Document & workspace symbols**, **document highlights**.
- **Completion**, **inlay hints** (inferred types), **semantic tokens**
  (type-aware highlighting), and **code actions** (quick fixes for suggested
  diagnostics).
- **File watching** across the project.

The full capability list is specified in
[`design/karn-lsp-spec.md`](https://github.com/accuser/karn/blob/main/design/karn-lsp-spec.md).

## Install

```sh
cargo install karn-lsp
```

Or build from the workspace:

```sh
cargo build --release -p karn-lsp   # → target/release/karnc-lsp
```

This produces the **`karnc-lsp`** binary. Requires a stable Rust toolchain,
2024 edition (MSRV 1.85).

## Use

`karnc-lsp` speaks LSP over stdio. Most users consume it through the
[VS Code extension](https://github.com/accuser/karn/tree/main/vscode-karn),
which bundles and launches it automatically. For other editors, point your LSP
client at the `karnc-lsp` binary and associate it with the `karn` language /
`.karn` files. See
[Set up editor support](https://github.com/accuser/karn/blob/main/docs/src/how-to/tooling/editor-support.md).

The server discovers a project by walking up to the nearest `karn.toml` (falling
back to single-file mode if there is none). It logs to `~/.karn-lsp.log` at
`warn` by default; set `KARN_LSP_LOG` (e.g. `KARN_LSP_LOG=debug`) to raise the
level. `karnc-lsp --version` prints the version.

## License

Licensed under either of [Apache-2.0](https://github.com/accuser/karn/blob/main/LICENSE-APACHE) or
[MIT](https://github.com/accuser/karn/blob/main/LICENSE-MIT) at your option.
