# docs-framework-scaffold — Documentation track, Slice 1: the Astro + Starlight scaffold

- **Scope:** an **infrastructure increment** — no grammar, compiler, emitter, or
  tooling-crate change, so it is **unversioned** (`<slug>.md`) and ships no release
  tag, mirroring slice 0. **Slice 1 of the documentation track**
  (`../tracks/documentation.md`); lands the framework ADR
  [0141](../decisions/0141-documentation-framework.md).
- **Realises:** the documentation track's §4 framework decision — the central,
  hard-to-reverse commitment. Stands up the Astro + Starlight site that replaces
  mdBook, proving the toolchain end-to-end ("the domain serves and highlighting
  works") without yet migrating any content.

## Context

The track designs a single coherent web presence; slice 0 deployed the playground,
and this slice lays the foundation everything else builds on. mdBook stays in `docs/`
and authoritative — this is a *parallel* scaffold, not a migration. The 129-page Book
port, the preprocessor→component reimplementation, and the verification harness are
later slices. Slice 1's whole job is to make the framework real and deployed: a
placeholder landing + an empty Book shell at `bynk-lang.org`, `noindex`'d, with
faithful `bynk` highlighting.

## Decisions

- **[A] Astro + Starlight, source in a new `site/`.** Recorded in full as ADR 0141.
  The source dir is `site/` (permanent — it does not affect the `bynk-lang.org` URLs);
  `docs/` (mdBook) is untouched until its content migrates, then removed.
- **[B] Highlight from the editor's TextMate grammar, not a copy.** `astro.config.mjs`
  loads `../vscode-bynk/syntaxes/bynk.tmLanguage.json` (scope `source.bynk`) into
  Expressive Code/Shiki as the `bynk` language — one grammar, two consumers (editor +
  site). The corpus-agreement drift check (track §5.1) is deferred to slice 2, once
  there is highlighted content to protect; slice 1 only proves a block highlights.
- **[C] Deploy the placeholder to the real apex now, behind `noindex`.** Per the
  track's slice-1 definition ("the domain serves"). A `<meta robots noindex>` head +
  a disallow-all `robots.txt` keep the scaffold out of search indexes until the
  landing is real (slice 6). The deploy reuses the slice-0 pattern: CI builds, wrangler
  uploads, the maintainer provisions the `bynk-lang` Pages project + apex DNS (the
  same `CLOUDFLARE_*` secrets, already configured).
- **[D] Build-time internal link check via `starlight-links-validator`,** replacing
  `mdbook-linkcheck` for the new site — a broken in-site link fails the build.
- **[E] Pin the Node/Astro toolchain.** A committed `site/package-lock.json` and
  **Node 22** in CI (Astro 7 floors Node at 22.12, matching the runtime/extension
  legs), so a green site build is reproducible.

## Risks & mitigations

- **A second build toolchain (Node/Astro) alongside Rust.** *Mitigation:* pinned the
  same way the Rust side is (committed lockfile, pinned CI Node); prior art in
  `playground/`.
- **tmLanguage diverging from tree-sitter on an edge construct.** *Mitigation:* out of
  scope here; carried by the slice-2 corpus check, with the playground's already-built
  wasm highlighter as the fallback.
- **A placeholder on the public apex getting crawled/indexed prematurely.**
  *Mitigation:* `noindex` head + disallow-all `robots.txt`; both lifted when the
  landing is real.
- **First push before the apex Pages project exists → a red deploy.** *Mitigation:*
  the upload step green-skips until the secrets/project are present (the slice-0
  pattern); the maintainer provisions per the runbook.

## Docs & tests

- **Docs delta.** **No `docs/src/` book impact** — slice 1 adds no Book content (the
  mdBook book stays current and authoritative until slice 2 migrates it). The new
  documentation is `site/README.md` (the apex deploy runbook + local build).
- **Tests.** A new `site` CI job builds the Astro site on every PR (running Pagefind
  and the link validator); registered in `ci-green`. Highlighting and `noindex` are
  asserted by inspecting the built `dist/` locally (the verification below).

## Done when

- **In-repo (this PR):** the `site/` scaffold, ADR 0141 (+ index row), the `site` CI
  gate, `deploy-site.yml`, and `site/README.md` are merged; `astro build` is green
  locally and in CI (internal links valid, `bynk` block highlighted, `noindex` +
  `robots.txt` present); this proposal is removed by a follow-up.
- **Live (maintainer ops, in the runbook):** the `bynk-lang` Pages project + apex DNS
  exist; a real deploy serves the placeholder at `https://bynk-lang.org` with a
  highlighted `bynk` block and a `noindex` response.
