# Bynk Site — The documentation & web presence for Bynk

An [Astro](https://astro.build/) + [Starlight](https://starlight.astro.build/) static site. It will replace the current mdBook book and deploys to `bynk-lang.org`. The framework decision is recorded in ADR 0141 (`../design/decisions/0141-documentation-framework.md`).

## Current state — placeholder scaffold (slice 1)

This is a scaffold, not the finished site. It ships a placeholder landing page and an *empty Book shell* only. The 129-page Book migration, the examples gallery, the developer docs, and the real landing page arrive in later slices.

The whole site is `noindex`'d for now — a `<meta robots>` head plus a disallow-all `robots.txt` — so the placeholder is not crawled. That is lifted in a later slice.

## How it fits together

- **Highlighting.** ` ```bynk ` code fences are highlighted by Shiki/Expressive Code, fed the editor's own TextMate grammar at `../vscode-bynk/syntaxes/bynk.tmLanguage.json` (scope `source.bynk`). One grammar, two consumers — the editor and the site. No copy is maintained here.
- **Search.** [Pagefind](https://pagefind.app/) — local and static, built automatically by `astro build`.
- **Link checking.** A build-time internal link check (`starlight-links-validator`) fails the build on a broken in-site link.
- **Toolchain.** Astro 7 + Starlight, Node ≥ 22.12 (Astro 7's floor). A committed `package-lock.json` pins it.

## Local development

- `npm install` — install deps.
- `npm run dev` — Astro dev server (it prints the local URL — `http://localhost:4321` by default).
- `npm run build` — static build into `site/dist/`; this also builds the Pagefind index and runs the internal link-checker.
- `npm run preview` — serve the built `dist/` locally.

## Deploy

The deploy is automated by `.github/workflows/deploy-site.yml`. It builds `site/dist/` and uploads it with `wrangler pages deploy` to a single Cloudflare Pages project. It runs on push to `main` (when `site/**` or the tmLanguage grammar changes) and on manual `workflow_dispatch` (Actions tab → "Deploy the docs site" → Run workflow).

The maintainer does a one-time account setup:

1. Create a Cloudflare **Pages** project of type **Direct Upload** named **`bynk-lang`** — this name is what the workflow's `--project-name` flag targets; keep them in sync if you rename.
2. Attach the custom domain `bynk-lang.org` (the apex) to the `bynk-lang` project. Cloudflare's custom-domain flow creates the DNS record when the zone is Cloudflare-managed.
3. The Cloudflare secrets — `CLOUDFLARE_API_TOKEN` (scoped to Account → Cloudflare Pages → Edit) and `CLOUDFLARE_ACCOUNT_ID` — are already configured as repo secrets (from the playground deploy). No new secrets are needed.
4. Trigger the first deploy — push to `main`, or run the workflow manually.

Until the project and secrets exist, the workflow still builds `site/dist/` and simply skips the upload — it reports a notice rather than failing.

Note: the deployed site is a `noindex` placeholder until a later slice ships the real landing.
