#!/usr/bin/env bash
# Set the single repo version across every versioned manifest.
#
# The repo carries one version while everything lives together (see
# design/README.md "Versioning & release"). The sites that must agree:
#
#   - Cargo.toml  [workspace.package] version
#   - Cargo.toml  in-workspace dependency requirements (path + version)
#   - vscode-karn/package.json        version + karnServerVersion ("vX.Y.Z" —
#     the GitHub Release the extension downloads server binaries from)
#   - tree-sitter-karn/package.json   version
#   - the lockfiles (Cargo.lock, both package-lock.json)
#
# The release workflow's verify job refuses a tag that doesn't match all of
# them, so run this in the increment PR and land the bump with the increment.
#
# Usage: scripts/bump-version.sh X.Y.Z
set -euo pipefail

ver="${1:?usage: scripts/bump-version.sh X.Y.Z}"
if ! printf '%s' "$ver" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
	echo "error: '$ver' is not a bare X.Y.Z version" >&2
	exit 1
fi

cd "$(dirname "$0")/.."

# Cargo workspace: [workspace.package] version + the in-workspace dependency
# requirements ({ path = "...", version = "..." }).
sed -i.bak -E \
	-e 's/^version = "[^"]+"/version = "'"$ver"'"/' \
	-e 's/(path = "[^"]+", version = )"[^"]+"/\1"'"$ver"'"/' \
	Cargo.toml
rm Cargo.toml.bak
cargo update --workspace --quiet

# npm manifests. Targeted sed (not `npm version`/JSON rewrite) so the bump
# never reformats the files. karnServerVersion is the extension's server pin —
# the GitHub Release tag it downloads binaries from.
sed -i.bak -E 's/^(  "version": )"[^"]+"/\1"'"$ver"'"/' \
	vscode-karn/package.json tree-sitter-karn/package.json
sed -i.bak -E 's/^(  "karnServerVersion": )"[^"]+"/\1"v'"$ver"'"/' \
	vscode-karn/package.json
rm vscode-karn/package.json.bak tree-sitter-karn/package.json.bak

# Sync the npm lockfiles to the new manifest versions.
(cd vscode-karn && npm install --package-lock-only --ignore-scripts >/dev/null)
(cd tree-sitter-karn && npm install --package-lock-only --ignore-scripts >/dev/null)

echo "bumped to $ver:"
grep -m1 '^version' Cargo.toml
node -p '"vscode-karn        " + require("./vscode-karn/package.json").version + " (server pin " + require("./vscode-karn/package.json").karnServerVersion + ")"'
node -p '"tree-sitter-karn   " + require("./tree-sitter-karn/package.json").version'
