# mdbook-retirement-delete — Documentation track, mdBook retirement 3b: remove mdBook

- **Scope:** an **infrastructure increment** — the pure-deletion close-out of the mdBook
  retirement. Step 3a ("cut the cord") repointed every doc generator, gate, and script to
  `site/` and stopped building/gating mdBook, leaving `docs/` and the three `mdbook-bynk-*`
  preprocessor crates physically present (dead, still compiling) as a one-cycle fallback. This
  step deletes them. No grammar/compiler/emitter behaviour change, so it is **unversioned** and
  ships no release tag. **mdBook retirement, step 3b of the documentation track**; implements ADR
  [0141](../decisions/0141-documentation-framework.md) — **no new ADR**.

## Context

Since 3a, nothing the project relies on reads `docs/` and mdBook is no longer built or gated.
The `docs/` tree (`book.toml`, `theme/`, `src/`, `grammar-semantics.json`) and the three
preprocessor crates have been dead weight ever since. The fallback cycle elapsed without
incident, so they are removed.

## Decisions

- **[A] Delete `docs/`** — `book.toml`, `docs/theme/`, `docs/src/**`, and `docs/grammar-semantics.json`.
  The diagnostics fixtures and `SUMMARY.md` already moved to `site/` in 3a; nothing else under
  `docs/` is referenced.
- **[B] Delete the three `mdbook-bynk-*` preprocessor crates** (`mdbook-bynk-grammar`,
  `mdbook-bynk-highlight`, `mdbook-bynk-visuals`) and remove them from the `Cargo.toml`
  `[workspace] members`. All three were `publish = false` and in no release list, so no release
  workflow changes. `bynk-grammar` (the EBNF renderer the old `mdbook-bynk-grammar` consumed)
  stays — it now feeds the test that emits the Book's grammar appendix.
- **[C] Repoint the references the deletion would dangle.** Active-code doc comments that named a
  generated page's old `docs/src/reference/*.md` path (`bynk-syntax`, `bynk-render`, `bynkc::cli`,
  `bynk-grammar`) point at the Book under `site/`; the remark plugin's provenance note is
  past-tense; and the **published crate/example READMEs** (`bynk`, `bynkc`, `bynk-fmt`,
  `bynk-lsp`, `vscode-bynk`, `examples/*`) and the root `README.md` repoint their now-404 GitHub
  `docs/src/*.md` links to the live `bynk-lang.org/book/` routes, drop the deleted-crate rows, and
  describe the Astro build (`cd site && npm install && npm run dev`).
- **[D] The internal `design/` corpus is left as-is.** ADR provenance lines, roadmaps, the living
  documentation-track doc, and other design notes that mention `docs/src/...` are point-in-time /
  historical records (and include in-progress track drafts); migrating those spec-path references
  is a separate content pass, not part of the mdBook retirement.

## End state

mdBook is gone: no `docs/` tree, no `book.toml`, no preprocessor crates, no workspace member
references. The Book builds solely from `site/` (Astro/Starlight), and every active-code,
workflow, and published-artifact reference points at `site/` or the live site.

## Risks & mitigations

- **A dangling reference ships to crates.io.** *Mitigation:* every `docs/src/*.md` link in a
  published README is repointed to a verified `bynk-lang.org/book/` route (each target slug
  confirmed to exist in the Book before repointing).
- **A workspace consumer depended on a deleted crate.** *Mitigation:* the three crates were leaf
  binaries (mdBook preprocessors), depended on by nothing; `cargo build`/`test`/`clippy` across
  the workspace stay green after removal.

## Verification

- **Rust:** clean `cargo test --workspace` + `cargo fmt --check` + `cargo clippy --workspace
  --all-targets -- -D warnings` green; `Cargo.lock` regenerates without the three crates.
- **Site:** clean `npm run build` green (strict link validation, mermaid) — confirming the two
  repointed Book pages introduce no broken links.
- **Deletion proof:** no `docs/`, `book.toml`, or `mdbook-bynk-*` reference remains in active
  code, any workflow, or a published artifact (`design/` historical notes excepted, per [D]).
