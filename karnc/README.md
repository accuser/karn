# karnc

[![crates.io](https://img.shields.io/crates/v/karnc.svg)](https://crates.io/crates/karnc)
[![docs.rs](https://img.shields.io/docsrs/karnc)](https://docs.rs/karnc)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg)](#license)

The **Karn compiler** — both a library and the `karnc` command-line tool. It
takes [Karn](https://github.com/accuser/karn) source, type-checks it, and emits
typed TypeScript targeting Cloudflare Workers.

Karn is a statically typed, architecture-first language: contexts, services,
agents, refined types, and capabilities are part of the language. See the
[Karn Book](https://github.com/accuser/karn/tree/main/docs) for the full guide
and reference.

## Pipeline

```text
lex  →  parse  →  resolve  →  check  →  emit
```

Each phase lives in its own module under `src/`:

- `lexer.rs` — `logos`-driven token stream.
- `parser.rs` — hand-written recursive descent, one function per precedence level.
- `resolver.rs` — builds the symbol table; flags duplicates, name overlap,
  unresolved references, and arity mismatches.
- `checker.rs` — type-checks every declaration and expression; validates
  refinement predicates and detects contradictory combinations.
- `emitter.rs` / `emitter/` — walks the typed AST and writes TypeScript.
- `project.rs` — multi-file projects: a directory of `.karn` units compiled into
  a tree of TypeScript mirroring the source layout.

Diagnostics flow through `error.rs` and [`ariadne`](https://crates.io/crates/ariadne).
Every error carries a dotted category (`karn.parse.expected_token`,
`karn.types.invalid_regex`, …), a source span, and a primary message; many carry
secondary labels and notes.

## Install

```sh
cargo install karnc
```

Or build from the workspace:

```sh
cargo build --release -p karnc   # → target/release/karnc
```

Requires a stable Rust toolchain, 2024 edition (MSRV 1.85).

## CLI

```sh
karnc check   <input>                         # type-check without emitting
karnc compile <input> -o <output> [--target bundle|workers]
karnc fmt     [inputs...] [--check]           # format in place (or `-` for stdin)
karnc test    [project] [--no-run]            # compile and run `test` blocks
```

`<input>` is either a single-file commons (`foo.karn`) or a project directory
containing a `karn.toml`. The `workers` target emits one Cloudflare Worker per
context, complete with router, dependency wiring, the shared runtime, and a
`wrangler.toml`. `karnc test` needs `node` and `tsc` on `PATH`.

Run `karnc <command> --help` for every flag, and see the
[CLI reference](https://github.com/accuser/karn/blob/main/docs/src/reference/cli.md).

## Library

```rust
use karnc::compile_project;

// Compile a project root (a directory containing `karn.toml`) into an
// in-memory tree of TypeScript files.
let output = compile_project(std::path::Path::new("path/to/project"))?;
```

The crate exposes the full compiler surface (`ast`, `lexer`, `parser`,
`resolver`, `checker`, `emitter`, `project`, `diagnostics`, …). The
single-string [`compile`] entrypoint handles a self-contained commons; the
[`compile_project`] family handles multi-file projects, build targets, and
platforms. See the [API docs](https://docs.rs/karnc).

## Tests

```sh
cargo test -p karnc
```

The end-to-end harness in `tests/` runs fixture-driven positive and negative
cases. Set `KARN_REQUIRE_TSC=1` to additionally type-check the emitted
TypeScript with `tsc` (CI does this).

## The language

The normative definition of the language this compiler accepts is the
specification in
[`docs/src/spec/`](https://github.com/accuser/karn/tree/main/docs/src/spec)
(rendered in the Karn Book), kept current per increment. The decisions behind
the increments are recorded in
[`design/decisions/`](https://github.com/accuser/karn/tree/main/design/decisions).

## License

Licensed under either of [Apache-2.0](https://github.com/accuser/karn/blob/main/LICENSE-APACHE) or
[MIT](https://github.com/accuser/karn/blob/main/LICENSE-MIT) at your option.
