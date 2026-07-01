# crate-api-docs — Documentation track follow-on: generated crate API docs + README refresh

- **Scope:** completes the crate-API-docs item the Developer Documentation slice (track §8) deferred —
  generated `cargo doc` rustdoc served on the site under `/docs/api/` — **and**, as part of the same
  effort, brings every workspace crate's `README.md` up to date. No grammar/compiler/emitter behaviour
  change → **unversioned**; implements ADR 0141 — **no new ADR**.
- **This PR (A)** does the README + crate-metadata refresh. **B** wires the rustdoc generation into the
  site build/deploy and CI. A cleanup PR deletes this proposal after B lands.

## Decisions

- **[A] Cover all 12 workspace members** (you), including the unpublished `bynk-wasm`. Publishable crates
  get the full README badge shape; `bynk-wasm` (`publish = false`) gets a lighter shape with no
  crates.io/docs.rs badges and a plain "not a published crate" note.
- **[B] READMEs are ground-truthed, not invented.** Each README is refreshed against the crate's
  `src/lib.rs` / `src/main.rs` `//!` header and its `Cargo.toml` `description`, matching the existing
  house style (badge row · description · responsibility breakdown · "Where it sits" pipeline diagram for
  the libs · `Use` example · License). The two missing READMEs (`bynk-strip`, `bynk-wasm`) are written;
  the stale `= "0.66"` dep examples move to `"0.109"`; `bynk-lsp` gains its docs.rs badge.
- **[C] Metadata + drift.** The 4 published crates lacking them gain `keywords`/`categories`
  (`bynk-strip`, `bynk-fmt`, `bynk-grammar`, `bynk-lsp`). `scripts/bump-version.sh` is extended to
  rewrite the README dep-example versions on release (a scoped `sed` over `bynk-… = "X.Y"` lines), so
  they track the version like the Book's banners already do and cannot drift again.
- **[D] Strict docs gate (B, you).** CI runs `RUSTDOCFLAGS="-D warnings" cargo doc --no-deps
  --workspace`, so a broken intra-doc link fails the build — the "cannot rot" discipline applied to the
  API docs.
- **[E] CI-generated, not committed (B).** The rustdoc tree is built in the deploy job and copied into
  `site/public/docs/api/` (which Astro serves verbatim at `/docs/api/`); it is gitignored. A generated
  `site/scripts/build-api-index.mjs` writes the top-level landing rustdoc omits for a workspace. The
  site link-checker excludes `/docs/api/**` (the tree is absent from local builds).

## End state

Every crate has an accurate, current README; the four published crates that lacked discovery metadata
have it; releases keep the README versions current automatically. (After B:) the site serves per-crate
Rust API docs at `/docs/api/`, linked from the Developer Documentation overview, regenerated on deploy
and gated strictly on PRs.

## Risks & mitigations

- **README example drifts from the real API.** *Mitigation:* [B] — examples are written against the
  crates' real public signatures (verified), and the dep versions are now bump-maintained.
- **`-D warnings` surfaces pre-existing doc-link warnings (B).** *Mitigation:* fixed in PR B as bounded
  `//!`/`///` edits; reported if more than a handful.
- **Rust toolchain coupled into the Node-only site deploy (B).** *Mitigation:* reuses the repo's pinned
  toolchain + rust-cache actions; the tree is gitignored so the path filters don't cross-trigger.

## Verification

- **A:** `cargo test --workspace` + `cargo fmt --check` + `cargo clippy --workspace --all-targets -- -D
  warnings` green; `cargo metadata` parses the new keywords; every crate has a README, no stale versions
  remain, `bynk-wasm` carries no crates.io/docs.rs badges.
- **B:** `RUSTDOCFLAGS="-D warnings" cargo doc --no-deps --workspace` clean; the landing links every
  generated crate; `npm run build` green with the validator exclude; `/docs/api/` eyeballed.

## Out of scope

`#![doc = include_str!("../README.md")]` crate front pages (doctest surface); third-party dep docs
(`--no-deps`); docs.rs config; slice 7 (inline playground embeds).
