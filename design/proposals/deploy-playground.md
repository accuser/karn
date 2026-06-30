# deploy-playground — Documentation track, Slice 0: deploy the shipped playground to Cloudflare Pages

- **Scope:** an **infrastructure/ops increment** — no grammar, compiler, emitter,
  or tooling-crate change, so it is **unversioned** (`<slug>.md`, no `vX.Y` prefix)
  and ships **no release tag** (nothing is published; `release.yml` is untouched).
  It is **Slice 0 of the documentation track** (`../tracks/documentation.md`).
- **Realises:** the documentation track's adoption of the **in-browser track's
  orphaned deploy**. That track shipped the playground (v0.108) but left "Cloudflare
  Pages deployment — two projects + DNS" as an explicit deferred follow-on, owned by
  nobody. Slice 0 takes ownership and stands the origins up. **No new ADR** — the
  decisions this realises (the cross-origin sandbox, the deep-link format) already
  shipped as [ADR 0140](../decisions/0140-repl-execution-and-sandbox.md); this slice
  only *deploys* what they defined.

## Context

The playground (`playground/`) is a fully static, client-side app: the compiler runs
in the browser as wasm, the compiled JS runs in a cross-origin sandbox. It works — and
is reachable by no one, because no origin serves it. Until it is live, every "Run in
playground" affordance the later doc slices emit has no target. Slice 0 depends on
**nothing else in the track** (no Astro, no framework decision, no content), so it
lands first and independently.

The deploy shape is already settled in `playground/README.md` §Deploy and fixed by the
build wiring: **one `dist/`**, built with the production origins (the `build.mjs`
default), deployed to **two** Cloudflare Pages projects. The app origin serves
`index.html` + `app.js` + the wasm compiler; the sandbox origin serves `sandbox.html`
+ `sandbox.js`. This proposal adds the in-repo half — the CI that builds and uploads —
and a maintainer runbook for the account-side half (projects, secrets, DNS), which is
not automatable from the repo.

## Decisions

- **[DECISION A] Build in GitHub Actions, upload the prebuilt `dist/` with
  `wrangler pages deploy` — not Cloudflare's Git-integration build.** *Recommend A.*
  The artefact needs the Rust + `wasm32` + `wasm-bindgen` + tree-sitter toolchains,
  which already live in CI; asking Cloudflare's builder to compile the compiler would
  duplicate and pin a second toolchain off-repo. CI builds; wrangler uploads. New
  workflow: `.github/workflows/deploy-playground.yml`, triggered on push to `main`
  touching `playground/** | bynk-wasm/** | tree-sitter-bynk/**`, plus
  `workflow_dispatch`.
- **[DECISION B] Two Pages projects, two origins, the *same* `dist/`.** *Settled by
  ADR 0140, restated because it is load-bearing.* The app and sandbox **must** be
  different origins — that separation *is* the safety boundary: untrusted snippet code
  executes only on the opaque sandbox origin and can never reach the app origin's
  storage. Deploying the app without its separate sandbox origin would silently break
  the security model, so the runbook bolds it and the workflow deploys both in one run.
- **[DECISION C] The grammar-wasm build is *required* in CI, not best-effort.** Local
  dev degrades gracefully when the web-tree-sitter grammar is absent (the editor falls
  back to the stream highlighter), but `npm run build` statically imports
  `src/vendor/highlights.scm`, which `build:grammar` stages — so the bundle does not
  build without it. The modern `tree-sitter build --wasm` downloads its own wasi-sdk
  toolchain (no emscripten/Docker setup), so the build is reliable in CI; the graceful
  fallback stays a property of the *code* for toolchain-less environments, not
  something CI leans on.
- **[DECISION D] A PR type-check gate for the playground, plus wiring the existing
  `wasm` job into the required check.** A new `playground` CI job type-checks the app
  (`tsc --noEmit`) so a TypeScript regression — or a `bynk-wasm` export-shape change
  reaching `app.ts`'s `./vendor/bynk_wasm.js` import — fails a PR rather than the deploy
  on `main`. It runs a *debug* wasm build (for the generated `.d.ts` the app types
  against) then `tsc`: cheaper than the deploy build (no release/wasm-opt, no grammar,
  no upload), gated on a new `playground` path filter (anchored on `playground/**` +
  `bynk-wasm/**`). Incidental fix in the same file: the `wasm` build job was **absent
  from the `ci-green` needs list**, so a broken wasm build could not fail the required
  check; since the playground's deployability depends on `bynk-wasm` compiling, `wasm`
  (and the new `playground` job) are added to `ci-green`.
- **[DECISION E] Unversioned, no tag.** Per the proposals lifecycle, an increment with
  no language/tooling artefact carries no version bump. Slice 0 publishes nothing and
  bumps nothing; the workspace stays at its current version. (The alternative —
  versioning the documentation track `v0.110.x` by analogy with the in-browser track's
  `v0.108.x` — is rejected: those slices shipped compiler/language features and were
  released; a deploy is neither.)

## Risks & mitigations

- **First push to `main` before the maintainer provisions Cloudflare → a red deploy.**
  *Mitigation:* the upload steps gate on the secrets being present (`if:
  env.CLOUDFLARE_API_TOKEN != ''`), so the workflow **builds and green-skips the
  upload** until the secrets exist; it turns into a real deploy the moment they do.
- **Token over-scope.** *Mitigation:* the runbook specifies a Cloudflare token scoped
  to **Pages:Edit** only, held as the `CLOUDFLARE_API_TOKEN` repo secret (plus
  `CLOUDFLARE_ACCOUNT_ID`).
- **Origin-separation regression.** *Mitigation:* DECISION B; the runbook's bolded note
  and the single workflow deploying both origins together.
- **Grammar-wasm build via Docker is slow** (image pull per run). *Mitigation:*
  acceptable on an infrequent, `main`-only deploy; an emscripten-native setup is a
  noted later speed-up, not needed for correctness.

## Docs & tests

- **Docs delta.** **No `docs/src/` book impact** — Slice 0 is an ops/deploy increment;
  the book itself is mdBook today and is migrated by later slices. The relevant
  documentation is the **maintainer runbook**, `playground/README.md` §Deploy, expanded
  here into a complete account-side checklist (the two secrets and the Pages:Edit token
  scope; creating the two direct-upload Pages projects and attaching the custom domains;
  the two DNS records; the bolded origin-separation security note). The existing
  share-Worker / `#hash`-fallback notes stay.
- **Tests.** The new `playground` PR type-check gate (above). Browser behaviour is not
  CI-testable; it is verified by `playground/README.md` §Verify locally (the two-origin
  build + the five run/diagnostic/lock/share/timeout checks), run locally before the PR
  and again against the real origins at go-live.

## Done when

- **In-repo (this PR):** `deploy-playground.yml`, the `playground` PR gate + `ci-green`
  wiring, and the expanded runbook are merged; local verification is green; this
  proposal file is deleted by the implementing PR.
- **Live (maintainer ops, tracked by the runbook):** the two Pages projects, the two
  repo secrets, and the two DNS records exist; a real deploy serves both origins; the
  README go-live checks pass against `https://playground.bynk-lang.org` with the sandbox
  iframe loading from `https://sandbox.bynk-lang.org`.
