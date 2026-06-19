//! v0.48: the first-party Bynk sources are now real files embedded via
//! `include_str!` (see `bynkc/src/firstparty/`). These tests give them the
//! standing guarantees they lacked as Rust string literals:
//!
//!  1. **Each source parses** — tokenises + `parse_unit` without errors, so the
//!     stdlib/surface can never ship un-parseable (previously only checked
//!     transitively, when a fixture happened to `uses` it).
//!  2. **Each source is `bynk-fmt`-clean** — formatting is a no-op, so the
//!     first-party sources obey the project's own formatting rules. (Reformatting
//!     a `.karn` source never changes emitted TypeScript — formatting is
//!     whitespace/trivia only — so this is independent of the byte-identical
//!     emitted-output guarantee, which the golden + tsc_verify suites pin.)
//!
//! Standalone `tsc --strict` over the embedded TypeScript runtime lives in
//! `tsc_verify.rs` (it reuses that file's tsc runner / skip-loudly logic).

use bynkc::fmt::{FormatOptions, format_source};
use bynkc::lexer::tokenize;
use bynkc::parser::parse_unit;

/// The first-party Bynk sources, by display name. All are `pub const` in
/// `bynkc::firstparty`, each now an `include_str!` of a real `.karn` file.
fn sources() -> Vec<(&'static str, &'static str)> {
    vec![
        ("karn.list", bynkc::firstparty::KARN_LIST_SRC),
        ("karn.map", bynkc::firstparty::KARN_MAP_SRC),
        ("karn.string", bynkc::firstparty::KARN_STRING_SRC),
        ("karn", bynkc::firstparty::KARN_ADAPTER_SRC),
        ("karn.cloudflare", bynkc::firstparty::CLOUDFLARE_ADAPTER_SRC),
    ]
}

#[test]
fn every_first_party_source_parses() {
    let mut failures = Vec::new();
    for (name, src) in sources() {
        let parsed = tokenize(src).and_then(|toks| {
            parse_unit(&toks, src).map_err(|errs| {
                errs.into_iter()
                    .next()
                    .unwrap_or_else(|| panic!("empty error list for {name}"))
            })
        });
        if let Err(e) = parsed {
            failures.push(format!("{name}: {} {}", e.category, e.message));
        }
    }
    assert!(
        failures.is_empty(),
        "first-party sources must tokenise + parse:\n{}",
        failures.join("\n")
    );
}

#[test]
fn every_first_party_source_is_fmt_clean() {
    let opts = FormatOptions::default();
    let mut failures = Vec::new();
    for (name, src) in sources() {
        match format_source(src, &opts) {
            Ok(formatted) if formatted == src => {}
            Ok(_) => failures.push(format!(
                "{name}: not bynk-fmt-clean (run bynk-fmt over bynkc/src/firstparty/)"
            )),
            Err(e) => failures.push(format!("{name}: format failed ({} errors)", e.errors.len())),
        }
    }
    assert!(
        failures.is_empty(),
        "first-party .karn sources must be bynk-fmt-clean:\n{}",
        failures.join("\n")
    );
}
