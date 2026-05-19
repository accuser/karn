# Karn for VS Code

Language support for [Karn](../karn-design-notes.md) source files (`.karn`):

- Syntax highlighting (TextMate grammar; the tree-sitter grammar at
  `../tree-sitter-karn/` is the source of truth and is mirrored here).
- Live diagnostics via the bundled `karnc-lsp` Language Server.
- Hover with type signatures and doc blocks.
- Go-to-definition for types, functions, capabilities, services, agents.
- Format-on-save via `karn-fmt` (honours `editor.formatOnSave`).
- Status-bar items for the project name and compiler version.

## Build & install (local)

```sh
# In this directory:
npm install
npm run build
# package a .vsix
npx vsce package
# install
code --install-extension karn-vscode-0.5.0.vsix
```

Ensure `karnc-lsp` is on `PATH` (or set `karn.executablePath` in VS Code
settings). Build the binary from the workspace root with
`cargo build --release -p karn-lsp`; the binary lives at
`target/release/karnc-lsp`.

## Settings

- `karn.executablePath` (default `karnc-lsp`): path to the LSP binary.
- `karn.trace.server` (`off` | `messages` | `verbose`): trace LSP protocol
  in the "Karn LSP" output channel.
