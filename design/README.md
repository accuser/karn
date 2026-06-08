# Design notes

Internal design records for Karn. These are the working references behind the
language and tooling — distinct from the published book under `docs/`, which is
the canonical, reader-facing spec and reference.

## Current state

- [`karn-status-and-roadmap.md`](karn-status-and-roadmap.md) — where the project
  is and where it's going.
- [`karn-design-notes.md`](karn-design-notes.md) — the long-form design rationale.
- [`karn-type-system.md`](karn-type-system.md) — the type system in depth.
- [`karn-lsp-spec.md`](karn-lsp-spec.md) — LSP capabilities; referenced from
  `karn-lsp/src/main.rs` and `karnc/src/fmt.rs`.
- [`karn-tree-sitter-spec.md`](karn-tree-sitter-spec.md) — tree-sitter highlight
  groups; referenced from `tree-sitter-karn/queries/highlights.scm`.
- [`karn-phd-exploratory-memo.md`](karn-phd-exploratory-memo.md) — exploratory
  research memo.

## History

- [`grammar-increments/`](grammar-increments/) — the grammar as it evolved,
  `v0.1` through `v0.16`. Superseded by the spec in `docs/src/spec/`; kept as the
  design record of how the language grew. Not maintained going forward.
