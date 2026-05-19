//! Round-trip + idempotency tests against the karnc positive fixture corpus.
//!
//! For every single-file fixture (those with `input.karn`), we:
//!  1. Format the source. It must succeed.
//!  2. Format the result again. It must equal the first format.
//!  3. Parse the formatted result. It must parse without errors (semantic
//!     preservation: formatter does not introduce syntax errors).
//!
//! Project-shaped fixtures (those with `src/`) are walked recursively and
//! each `.karn` file is tested the same way.

use std::fs;
use std::path::{Path, PathBuf};

use karn_fmt::{FormatOptions, format_source};
use karnc::lexer::tokenize;
use karnc::parser::parse_unit;

fn fixture_dirs() -> Vec<PathBuf> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("karnc/tests/fixtures/positive");
    let mut out = Vec::new();
    if let Ok(rd) = fs::read_dir(&root) {
        for entry in rd.flatten() {
            let p = entry.path();
            if p.is_dir() {
                out.push(p);
            }
        }
    }
    out.sort();
    out
}

fn collect_karn_files(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if let Ok(rd) = fs::read_dir(&dir) {
            for entry in rd.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    stack.push(p);
                } else if p.extension().and_then(|e| e.to_str()) == Some("karn") {
                    out.push(p);
                }
            }
        }
    }
    out.sort();
    out
}

fn check_file(path: &Path, opts: &FormatOptions) -> Result<(), String> {
    let source = fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let once = format_source(&source, opts).map_err(|e| {
        format!(
            "first format of {}: {} errors",
            path.display(),
            e.errors.len()
        )
    })?;
    let twice = format_source(&once, opts).map_err(|e| {
        format!(
            "second format of {}: {} errors",
            path.display(),
            e.errors.len()
        )
    })?;
    if once != twice {
        return Err(format!(
            "formatter not idempotent on {}:\n--- once ---\n{once}\n--- twice ---\n{twice}",
            path.display()
        ));
    }
    // Round-trip parse.
    let tokens = tokenize(&once).map_err(|e| {
        format!(
            "re-tokenise formatted output {}: {}",
            path.display(),
            e.message
        )
    })?;
    parse_unit(&tokens, &once).map_err(|errs| {
        format!(
            "re-parse formatted output {}: {} errors; first: {}",
            path.display(),
            errs.len(),
            errs.first().map(|e| e.message.as_str()).unwrap_or("?")
        )
    })?;
    Ok(())
}

#[test]
fn round_trip_positive_corpus() {
    let opts = FormatOptions::default();
    let mut failures = Vec::new();
    for dir in fixture_dirs() {
        let input = dir.join("input.karn");
        let src_dir = dir.join("src");
        if input.exists() {
            if let Err(e) = check_file(&input, &opts) {
                failures.push(e);
            }
        } else if src_dir.is_dir() {
            for f in collect_karn_files(&src_dir) {
                if let Err(e) = check_file(&f, &opts) {
                    failures.push(e);
                }
            }
        }
    }
    if !failures.is_empty() {
        panic!(
            "formatter round-trip failures ({}):\n{}",
            failures.len(),
            failures.join("\n\n")
        );
    }
}
