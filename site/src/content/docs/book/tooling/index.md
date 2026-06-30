---
title: Tooling
---
Documentation for the tools around the Bynk compiler. If you just want editor
support, the how-to [Set up editor support](/book/guides/editor-and-tooling/editor-support/)
is the quickest path; the pages here are the reference for each tool.

| Tool | Binary / package | Purpose |
|---|---|---|
| [`bynk-fmt`](/book/tooling/bynk-fmt/) | `bynkc fmt` | The canonical source formatter. |
| [`bynk-lsp`](/book/tooling/bynk-lsp/) | `bynkc-lsp` | The language server (diagnostics, hover, go-to-definition, formatting). |
| [`tree-sitter-bynk`](/book/tooling/tree-sitter-bynk/) | — | The grammar used for highlighting and structural tooling. |
| [`vscode-bynk`](/book/tooling/vscode-bynk/) | VS Code extension | Editor integration built on `bynkc-lsp`. |

All are built from the same repository as the compiler, so they track the
language version for version (currently v0.109).
