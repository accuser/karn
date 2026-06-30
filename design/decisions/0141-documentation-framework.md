# 0141 — The documentation framework: Astro + Starlight, replacing mdBook

- **Status:** Accepted (documentation track, slice 1).
- **Provenance:** the first slice of the documentation track — the scaffold that
  stands up the web presence the track designs. Slice 0 (deploying the shipped
  playground) carried no decision; this is the track's first ADR and its
  load-bearing, hard-to-reverse commitment: the framework the whole site is built
  on. Not security-bearing (a static content site — no capability surface), but hard
  to reverse once ~130 pages and a deploy depend on it, so it is recorded up front.
  (Provenance is stated in plain text: the track doc and the slice proposal are
  transient and get deleted, so this record does not link them.)
- **Relation to prior records:** reuses the Cloudflare-Pages posture and the
  `CLOUDFLARE_*` secrets the track adopted when it deployed the playground (slice 0),
  and will emit the same `#…` snippet deep-link format ratified in
  [ADR 0140](0140-repl-execution-and-sandbox.md) D5 (the playground decodes it).

## Context

Bynk's documentation today is an mdBook book (`docs/`) published to GitHub Pages,
with three in-house Rust preprocessors (grammar embed, diagnostics semantics,
callouts/Mermaid) and a tree-sitter-based highlighter. The documentation track's
brief is one coherent web presence — a marketing landing page, the long-form Book,
an examples gallery, developer docs, and embedded interactive playground panels —
under one domain and design system. mdBook does the book well and the rest poorly:
no first-class landing-page story, no component/island model for interactive embeds,
a theme system that fights bespoke layouts. Stitching a hand-built landing and a
gallery onto an mdBook book yields two design systems and a seam the reader feels. A
single framework removes that seam.

Two assets bound the choice: the project already maintains a **TextMate grammar** for
Bynk (`vscode-bynk/syntaxes/bynk.tmLanguage.json`, scope `source.bynk` — the editor's
own), and the site must build **static** and deploy to Cloudflare, where the language
and the playground already live.

## Decision

**Migrate the whole web presence onto [Astro](https://astro.build) + the
[Starlight](https://starlight.astro.build) docs framework, static-built and deployed
to Cloudflare Pages, replacing mdBook and the GitHub-Pages posture.**

- **D1 — Astro + Starlight: one project for landing *and* docs.** Astro renders a
  bespoke marketing landing and the Starlight docs from a single codebase and design
  system — the one thing mdBook cannot do. Starlight ships the docs chrome (sidebar,
  table of contents, dark/light, edit-this-page, accessible nav) and **Pagefind**
  local static search, so the bulk of the Book's chrome is replaced, not rebuilt.
  Alternatives weighed and rejected: keep-mdBook + hand-build the rest (the
  two-design-system outcome the brief escapes); VitePress (weaker landing/island
  story, no content-collection schema validation); Docusaurus (heavier React runtime,
  weaker static-marketing story); Fumadocs/Nextra (a Next.js server posture, overkill
  for static). Astro + Starlight is the only option that wins both deciding factors —
  the existing grammar and single-project landing+docs — cleanly.

- **D2 — Highlight from the editor's own TextMate grammar; no second highlighter.**
  Starlight's Expressive Code/Shiki consumes `bynk.tmLanguage.json` directly as a
  custom language (fenced id `bynk`, scope `source.bynk`). The site becomes a second
  consumer of the same grammar the editor uses — faithful, zero new artefacts, one
  place to keep in step. The tree-sitter-exact wasm highlighter the playground already
  ships is the escape hatch if the tmLanguage proves lossy; a CI corpus-agreement
  check is a later slice's concern, once there is highlighted content to protect.

- **D3 — Static output to Cloudflare Pages, source in `site/`.** Astro builds to
  static HTML/CSS/JS — no server runtime — deployed to a Cloudflare Pages project at
  the `bynk-lang.org` apex, the same posture and the same `CLOUDFLARE_*` secrets as
  the slice-0 playground deploy. The source lives in a new top-level `site/`; the
  `docs/` mdBook source is untouched until its content migrates, then removed. A
  build-time **internal link check** (`starlight-links-validator`) replaces
  `mdbook-linkcheck`, so the site is never self-inconsistent.

- **D4 — The Rust generators stay canonical; only the rendering host moves.** This
  commits the *framework*, not the migration. The Rust crates that render the grammar
  reference and diagnostics semantics keep their role as the canonical data source;
  reimplementing their *embedding* as Astro components, and porting the ~130 Book
  pages, is the next slice. mdBook and its GitHub-Pages deploy stay in place and
  authoritative until that migration lands.

## Consequences

- The framework is the increment's hard-to-reverse bet: once the Book and the deploy
  depend on Astro, moving off it is a second migration. The bet is hedged by Astro's
  static output (the HTML is portable) and by keeping the canonical generators in Rust
  (host-independent).
- Two build toolchains now coexist — Rust (the compiler/generators) and Node/Astro
  (the site) — until mdBook is retired. The Node toolchain is pinned the way the Rust
  one is (a committed lockfile, a pinned Node version in CI), so a green build stays
  reproducible. Astro 7 floors Node at 22.12, matching the runtime/extension CI legs.
- A second highlighter is explicitly *not* introduced: the editor grammar is the
  single source. The residual risk — tmLanguage diverging from tree-sitter on an edge
  construct — is carried by a later corpus-agreement check, with the already-built
  wasm highlighter as the fallback.
- Pre-1.0, URLs are transient: no legacy mdBook redirect map is carried; a
  redirect/permalink policy becomes a deliberate commitment at 1.0.
- Slice 1 ships only the scaffold — a `noindex` placeholder landing + an empty Book
  shell — proving the domain serves and `bynk` highlighting works. The Book migration,
  the verification harness, By Example, the developer docs, the real landing, and the
  live playground embeds are the slices that follow.
