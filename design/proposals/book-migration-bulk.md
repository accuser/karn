# book-migration-bulk — Documentation track, Slice 2b: bulk-port the Book

- **Scope:** an **infrastructure increment** — it runs the slice-2a machinery over the
  whole Book and adds one Node generator (the sidebar). No grammar, compiler, or emitter
  change, so it is **unversioned** (`<slug>.md`) and ships no release tag, mirroring slices
  0–2a. **Slice 2b of the documentation track** (`../tracks/documentation.md`); implements
  the framework ADR [0141](../decisions/0141-documentation-framework.md) — **no new ADR**.
- **Realises:** the track's §5 Book migration. Slice 2a built and proved the machinery on
  four pages (#406); 2b is the mechanical payoff — the entire 129-page Book is served from
  Astro/Starlight at `bynk-lang.org/book/`, with the sidebar generated from the Book's own
  `SUMMARY.md` and **strict** internal-link validation restored.

## Context

mdBook stays authoritative and untouched in `docs/`; its retirement (repointing the doc
generators, deleting `docs/`/`book.toml`/the preprocessor crates/`pages.yml`) is a separate,
later slice. This still stands the Astro Book up *alongside* mdBook. The migration is purely
mechanical: every `{{#grammar}}`/`{{#grammar-semantics}}`/`{{#include}}`, callout, mermaid
diagram, `{#id}` anchor and `.md` link is already handled by the slice-2a remark plugin and
`migrate-page.mjs` codemod — proven here to carry the whole corpus with zero plugin errors.

## Decisions

- **[A] Sidebar generated from `SUMMARY.md`.** `site/scripts/generate-sidebar.mjs` parses the
  mdBook table of contents (part headers → groups, nested `- [T](p.md)` items, the prefix
  chapter → the Book root, the `---` separator ignored) into the committed
  `site/src/generated/sidebar.json` that `astro.config.mjs` imports. A part that wraps a single
  index page is collapsed (so it reads "Guides › …", not "Guides › Guides"); a parent page with
  children surfaces its own page as a leading "Overview" link (stock Starlight groups carry no
  link). A `--check` mode guards drift, wired into the `site` CI job — the same generate→commit
  →drift-guard shape as `build-llms-full.sh`.
- **[B] Bulk-run the codemod over all 128 `SUMMARY.md` pages** into
  `site/src/content/docs/book/`, committing the output (mdBook's `docs/src/` originals
  untouched). No codemod change was needed.
- **[C] `introduction.md` becomes the Book root.** mdBook's prefix chapter is the landing, so it
  migrates to `book/index.md` (slug `/book/`), replacing the slice-1 placeholder shell; the
  standalone slice-2a `book/introduction.md` proof page is dropped. The splash landing and
  `noindex` are unchanged — the real landing and lifting `noindex` are slice 6.
- **[D] `ebnf` fences render as plain frames.** The generated grammar-appendix pages carry a
  literal ` ```ebnf ` block (not a `{{#grammar}}` directive); Shiki has no EBNF grammar, so the
  remark plugin maps a `lang === 'ebnf'` code node to `null` — the same render the `{{#grammar}}`
  output already uses.
- **[E] Strict link validation restored.** With the whole Book present, the slice-2a
  `exclude: ['/book/**']` is dropped from `starlightLinksValidator()`; a broken in-site link now
  fails the build.

## Risks & mitigations

- **Pre-existing broken intra-page anchors surfaced by strict validation.** The whole corpus
  produced only **four** — all in `spec/syntactic-grammar.md`, hand-written §-number cross-refs
  that were dead in mdBook too (mdbook-linkcheck does not validate intra-page fragments).
  *Mitigation:* fixed at source by giving those four headings explicit `{#id}` ids matching their
  cross-references (the plugin honours `{#id}`), so both mdBook and the Astro Book resolve; the
  source edit means `llms-full.txt` is regenerated. **Note for the author:** three of those four
  links also carry a *visible* section number that disagrees with the heading (e.g. a link reads
  "§4.1.6" but lands on "§4.1.7") — a pre-existing spec-numbering drift left as-is here, worth a
  separate content pass.
- **Sidebar drifting from `SUMMARY.md`.** *Mitigation:* the committed `sidebar.json` is
  drift-guarded by `generate-sidebar.mjs --check` in CI; the `site` filter now fires on
  `SUMMARY.md`.

## Verification

- **Local:** clean `npm ci` + `npm run build` green with **all 129 pages** and **strict**
  validation — every directive expands, mermaid renders to inline SVG across the corpus,
  callouts/asides/`{#id}` anchors resolve, and *all* internal links validate.
  `node scripts/generate-sidebar.mjs --check` clean; `scripts/build-llms-full.sh --check` clean.
- **CI:** the `site` job builds the full Book + runs the sidebar drift check + the Chromium/mermaid
  step; mdBook's `docs` job and `doc_examples` stay green (content not moved). No Rust changed.
