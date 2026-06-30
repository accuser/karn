// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightLinksValidator from "starlight-links-validator";
// The single source of truth for Bynk highlighting is the VS Code TextMate
// grammar — the same file the editor uses (scopeName: source.bynk). Shiki
// consumes it directly, so the site never maintains a second highlighter.
import bynkGrammar from "../vscode-bynk/syntaxes/bynk.tmLanguage.json" with { type: "json" };

// https://astro.build/config
export default defineConfig({
  site: "https://bynk-lang.org",
  integrations: [
    starlight({
      title: "Bynk",
      // Slice 1 ships a placeholder scaffold, not real content — keep it out of
      // search indexes until the landing + Book are real (removed in slice 6).
      head: [{ tag: "meta", attrs: { name: "robots", content: "noindex, nofollow" } }],
      // Build-time internal link checking (the link-check gate): a broken in-site
      // link fails `astro build`.
      plugins: [starlightLinksValidator()],
      // Faithful `bynk` highlighting from the editor's own grammar; the fenced
      // language id is `bynk` (the grammar's own name is the display "Bynk").
      expressiveCode: {
        shiki: { langs: [{ ...bynkGrammar, name: "bynk" }] },
      },
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/accuser/bynk" }],
      sidebar: [{ label: "The Book", items: [{ label: "Introduction", link: "/book/" }] }],
    }),
  ],
});
