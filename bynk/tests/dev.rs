//! `bynk dev` — the deterministic output surface, pinned by goldens (proposal
//! §5). The `wrangler dev` stream itself (ports, timestamps, reload chatter) is
//! non-deterministic and is *not* goldened; what's pinned here is the part the
//! driver owns and renders itself: the **pre-flight failure report** and the
//! **context-selection** messages. The serve hand-off is covered by the unit
//! tests in `dev.rs` (selection rule, exit-code mapping) and the live
//! validation run, not by asserting wrangler's stdout.
//!
//! Goldens are blessed with `BYNK_BLESS=1 cargo test -p bynk`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use bynk::compiler::{Compiler, Origin, Skew};
use bynk::dev::{self, SelectError};
use bynk::doctor::{self, Capability, Context, DoctorOptions};
use bynk::probe::{Toolbox, Version};

// ---------------------------------------------------------------------------
// Minimal fake toolbox (deterministic, host-independent)
// ---------------------------------------------------------------------------

#[derive(Default)]
struct Fake {
    on_path: HashMap<String, PathBuf>,
    versions: HashMap<PathBuf, Version>,
}

impl Fake {
    fn path_tool(mut self, tool: &str, path: &str, ver: Version) -> Self {
        let p = PathBuf::from(path);
        self.on_path.insert(tool.into(), p.clone());
        self.versions.insert(p, ver);
        self
    }
}

impl Toolbox for Fake {
    fn on_path(&self, tool: &str) -> Option<PathBuf> {
        self.on_path.get(tool).cloned()
    }
    fn in_dir(&self, _dir: &Path, _tool: &str) -> Option<PathBuf> {
        None
    }
    fn version(&self, path: &Path) -> Option<Version> {
        self.versions.get(path).copied()
    }
    fn npx_available(&self) -> bool {
        false
    }
}

fn v(major: u32, minor: u32, patch: u32) -> Version {
    Version {
        major,
        minor,
        patch,
    }
}

/// A `bynkc` resolved on PATH at a fixed path/version, so the rendered report is
/// stable across version bumps.
fn bynkc_pinned() -> Compiler {
    Compiler {
        path: Some(PathBuf::from("/opt/bynk/bin/bynkc")),
        origin: Some(Origin::Path),
        version: Some(v(9, 9, 9)),
        skew: Some(Skew::Match),
    }
}

fn names(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

fn bless_or_assert(name: &str, actual: &str) {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/golden")
        .join(name);
    if std::env::var_os("BYNK_BLESS").is_some() {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, actual).unwrap();
        return;
    }
    let expected = std::fs::read_to_string(&path).unwrap_or_else(|_| {
        panic!(
            "missing golden {}; regenerate with BYNK_BLESS=1 cargo test -p bynk",
            path.display()
        )
    });
    assert_eq!(
        actual, expected,
        "golden {name} drifted; re-bless with BYNK_BLESS=1 cargo test -p bynk"
    );
}

// ---------------------------------------------------------------------------
// Pre-flight failure output
// ---------------------------------------------------------------------------

#[test]
fn golden_preflight_deploy_missing() {
    // Node present, wrangler absent and not provisionable → the deploy
    // capability fails, so `bynk dev` bails before compiling and prints this.
    let fake = Fake::default().path_tool("node", "/usr/bin/node", v(20, 0, 0));
    let ctx = Context {
        project_root: None,
        in_repo: false,
        node_floor: 18,
    };
    let opts = DoctorOptions {
        only: Some(Capability::Deploy),
        strict: false,
    };
    let mut report = doctor::diagnose(&fake, &bynkc_pinned(), &ctx, &opts);
    report.driver_version = "9.9.9".to_string(); // pin, survives version bumps

    // Sanity: this environment really does gate `dev`.
    assert!(
        report.exit_nonzero(&opts),
        "deploy must fail with no wrangler"
    );

    bless_or_assert(
        "dev-preflight.txt",
        &dev::preflight_failure_message(&report),
    );
}

// ---------------------------------------------------------------------------
// Context-selection messages (the CLI prints `bynk: {error}`)
// ---------------------------------------------------------------------------

#[test]
fn golden_select_errors() {
    let cases = [
        // Several contexts, no --context.
        dev::select_context(&names(&["api", "worker"]), None),
        // --context names something that wasn't built.
        dev::select_context(&names(&["api"]), Some("nope")),
        // Nothing was built at all.
        dev::select_context(&[], None),
    ];
    let mut out = String::new();
    for case in cases {
        let err: SelectError = case.expect_err("these cases must fail selection");
        out.push_str(&format!("bynk: {err}\n"));
    }
    bless_or_assert("dev-select-errors.txt", &out);
}
