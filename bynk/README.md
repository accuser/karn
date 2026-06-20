# bynk

[![crates.io](https://img.shields.io/crates/v/bynk.svg)](https://crates.io/crates/bynk)
[![docs.rs](https://img.shields.io/docsrs/bynk)](https://docs.rs/bynk)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg)](#license)

The **Bynk driver** — a thin orchestrator over the
[`bynkc`](https://crates.io/crates/bynkc) compiler and the Node toolchain.
`bynk` is to `bynkc` what `cargo` is to `rustc`: the compiler stays pure
(compile / check / fmt / test), while environment orchestration — *is my machine
ready?*, *scaffold me a project*, *build and serve it locally* — lives in the
driver.

See the [Bynk Book](https://github.com/accuser/bynk/tree/main/docs) for the full
guide and reference, and the
[`bynk` CLI reference](https://github.com/accuser/bynk/blob/main/docs/src/reference/bynk-cli.md)
for every argument and exit code.

## The project-lifecycle arc

The driver's commands form a three-step on-ramp, **`doctor → new → dev`**:

```sh
bynk doctor       # is my machine ready to compile, test, and deploy?
bynk new hello    # scaffold a complete, runnable project
cd hello
bynk dev          # build it and serve it locally on http://localhost:8787
```

| Command | What it does |
|---|---|
| `bynk doctor` | Survey the toolchain grouped by capability (compile · test · dev/deploy · editor · build-from-source), reporting presence + version + provenance, and print the exact remedy for anything missing. |
| `bynk new <path>` | Scaffold a complete, runnable single-context HTTP service (`bynk.toml`, `.gitignore`, `src/<name>.bynk`) that `bynk dev` serves unmodified. Pure offline file-writing — no toolchain required. |
| `bynk dev` | Build the project and serve it locally with `wrangler dev` in local mode (Miniflare) — one step in place of the manual `bynkc compile` + `cd` + `wrangler dev` recipe. No provisioning needed. |

Each command has a pinned argument/exit contract; run `bynk <command> --help`
for the flags.

## Install

```sh
cargo install bynk
```

Or build from the workspace:

```sh
cargo build --release -p bynk   # → target/release/bynk
```

Requires a stable Rust toolchain, 2024 edition (MSRV 1.85). `bynk doctor` and
`bynk dev` shell out to `bynkc` (resolved as `$BYNK_BYNKC` → `PATH` → a sibling
of the `bynk` binary) and, for `dev`, to Node + `wrangler`; `bynk new` needs none
of them — it only writes files.

## Design

- **Thin orchestrator** — the driver shells `bynkc` and the Node toolchain; it
  does not link the compiler pipeline. It reads only the single-sourced Node
  floor and the project-rooting helpers from `bynkc`
  ([ADR 0083](https://github.com/accuser/bynk/blob/main/design/decisions/0083-bynk-driver-thin-orchestrator.md)).
- **Single-concern modules** — `probe` (portable tool detection: presence +
  version + provenance, via the `which` crate), `compiler` (locate `bynkc` and
  report driver↔compiler version skew), `doctor`, `new`, `dev`, and `report`.
- **Deterministic surface** — the human-facing output of each command is pinned
  by goldens in `tests/` (blessed with `BYNK_BLESS=1 cargo test -p bynk`), and
  `new`'s embedded starter template is compile-tested so the scaffold can't rot.

The decisions behind each command are recorded in
[`design/decisions/`](https://github.com/accuser/bynk/tree/main/design/decisions)
(ADRs 0083–0084 for `doctor`, 0096 for `dev`, 0097 for `new`).

## Tests

```sh
cargo test -p bynk
```

## License

Licensed under either of [Apache-2.0](https://github.com/accuser/bynk/blob/main/LICENSE-APACHE) or
[MIT](https://github.com/accuser/bynk/blob/main/LICENSE-MIT) at your option.
