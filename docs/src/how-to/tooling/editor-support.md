# Set up editor support

**Goal:** get syntax highlighting, diagnostics, hover, and go-to-definition in
your editor.

## VS Code

The `vscode-karn` extension provides syntax highlighting plus live language
features backed by the `karnc-lsp` language server.

**1. Build the language server** from the workspace root:

```sh
cargo build --release -p karn-lsp
```

This produces `target/release/karnc-lsp`. Put it on your `PATH`, or point the
extension at it with the `karn.executablePath` setting.

**2. Build and install the extension** from the `vscode-karn/` directory:

```sh
cd vscode-karn
npm install
npm run build
npx vsce package
code --install-extension karn-vscode-*.vsix
```

The extension activates on `.karn` files and on any workspace containing a
`karn.toml`. You then get syntax highlighting, live diagnostics, hover with type
signatures, go-to-definition, and format-on-save (honouring
`editor.formatOnSave`).

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `karn.executablePath` | `karnc-lsp` | Path to the language-server binary. |
| `karn.trace.server` | `off` | Trace LSP traffic (`off` / `messages` / `verbose`) in the "Karn LSP" output channel. |

## Other editors

Any editor with a generic LSP client can use `karnc-lsp`. Syntax highlighting is
also available through the [`tree-sitter-karn`](../../tooling/tree-sitter-karn.md)
grammar.

## Related

- [Format your code with `karn-fmt`](format.md).
- Reference: [`karn-lsp`](../../tooling/karn-lsp.md).
