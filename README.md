# Karn

[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg)](#license)
[![Rust 2024 (MSRV 1.85)](https://img.shields.io/badge/rust-2024%20edition%20%C2%B7%20MSRV%201.85-orange.svg)](rust-toolchain.toml)

**Karn** is a statically typed, *architecture-first* programming language for
building services. The shape of a program — its contexts, services, agents, and
the types that flow between them — is part of the language, not a convention
layered on top. Karn compiles to **typed TypeScript** and targets **Cloudflare
Workers**.

> ⚠️ Karn is **pre-1.0 and under active development.** The language evolves in
> small, spec-first increments. The [Karn Book](docs/) documents *what compiles
> today*; planned features are marked as planned.

## The idea in one example

```karn
context greet

service api {
  on http GET "/ping" () -> Effect[HttpResult[String]] {
    Ok("pong")
  }
}
```

Compiling this with `karnc` produces TypeScript you can read, run, and deploy —
the router, boundary validation, and the Worker entry point are generated for
you.

## What makes Karn distinct

- **Make illegal states unrepresentable.** *Refined types* (types carrying a
  predicate), *opaque types*, and errors-as-values (`Result`, `Ok`/`Some`/
  `None`) let whole classes of bug go unexpressed.
- **Architecture in the language.** Contexts, services, and stateful *agents*
  are first-class, and a `context` is the unit of deployment — it becomes one
  Cloudflare Worker.
- **Honest effects and capabilities.** Dependencies are declared in signatures
  (`given Logger`), supplied by the platform, and mockable in tests.
- **Compiles to TypeScript.** You get JavaScript-ecosystem interop and a natural
  fit for Cloudflare Workers, with a static type system in front of it.
- **Testing is built in.** `test` blocks, `assert`, dependency `mocks`, and
  `Mock[T]` value fabrication ship with the language.

## Install

Karn is not yet on a package registry for end users; install it by building from
source with a recent Rust toolchain (stable, 2024 edition — see
[rustup](https://rustup.rs/)).

```sh
git clone https://github.com/accuser/karn.git
cd karn
cargo install --path karnc      # the `karnc` compiler
cargo install --path karn-lsp   # optional: the `karnc-lsp` language server
```

`karnc --help` lists the four commands: `compile`, `check`, `fmt`, and `test`.

## Quick start

Try the bundled [`examples/hello-world`](examples/hello-world/) — a complete
project you can check, test, compile, and deploy:

```sh
cd examples/hello-world
karnc check src      # type-check without emitting
karnc test .         # compile and run the `test` blocks (needs node + tsc)
karnc compile src --output out --target workers   # emit a Cloudflare Worker
```

A new program needs only a `karn.toml` manifest and a `.karn` file. See
[Compile your first program](docs/src/tutorials/01-first-program.md).

## Repository layout

This is a Cargo workspace. The published crates are `karnc`, `karn-fmt`,
`karn-grammar`, and `karn-lsp`.

| Path | What it is | Published as |
| ---- | ---------- | ------------ |
| [`karnc/`](karnc/) | The compiler library and `karnc` CLI (lex → parse → resolve → check → emit). | [crates.io](https://crates.io/crates/karnc) |
| [`karn-fmt/`](karn-fmt/) | The Karn formatter, behind a small public surface. | [crates.io](https://crates.io/crates/karn-fmt) |
| [`karn-grammar/`](karn-grammar/) | Renders the tree-sitter grammar to EBNF for the book's grammar reference. | [crates.io](https://crates.io/crates/karn-grammar) |
| [`karn-lsp/`](karn-lsp/) | The `karnc-lsp` Language Server (diagnostics, hover, go-to-definition, …). | [crates.io](https://crates.io/crates/karn-lsp) |
| [`tree-sitter-karn/`](tree-sitter-karn/) | The tree-sitter grammar — the source of truth for syntax highlighting. | npm |
| [`vscode-karn/`](vscode-karn/) | The VS Code extension (bundles the language server). | — |
| [`mdbook-karn-grammar/`](mdbook-karn-grammar/), [`mdbook-karn-highlight/`](mdbook-karn-highlight/), [`mdbook-karn-visuals/`](mdbook-karn-visuals/) | mdBook preprocessors that build the Karn Book. | — |
| [`docs/`](docs/) | The Karn Book (mdBook): tutorials, how-to guides, reference, and the normative spec. | — |
| [`design/`](design/) | Internal design notes and decision records (ADRs). | — |
| [`examples/`](examples/) | Example projects. | — |

## Documentation

The **[Karn Book](docs/)** is the canonical guide and reference. It follows
[Diátaxis](https://diataxis.fr/), grouped concern-first so each topic keeps its
explanation, recipes, and reference together:

- **[Tutorials](docs/src/tutorials/01-first-program.md)** — learn Karn by building.
- **[Guides](docs/src/guides/index.md)** — task-focused recipes, each section
  opening with the *why* before the *how*.
- **[Reference](docs/src/reference/index.md)** — exact behaviour, including the
  [normative spec](docs/src/spec/) and [CLI reference](docs/src/reference/cli.md).

Build the book locally with [mdBook](https://rust-lang.github.io/mdBook/):
`mdbook serve docs`.

## Status

Karn is pre-1.0. Some designed features (events, sagas, storage kinds) are
**deferred, not missing**, and land in later increments. See the
[status and roadmap](design/karn-status-and-roadmap.md).

## License

Licensed under either of

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))
- MIT license ([LICENSE-MIT](LICENSE-MIT))

at your option. Unless you explicitly state otherwise, any contribution
intentionally submitted for inclusion in the work by you, as defined in the
Apache-2.0 license, shall be dual licensed as above, without any additional
terms or conditions.
