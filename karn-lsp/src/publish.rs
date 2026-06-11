//! v0.24 (ADR 0052): the project-wide publish plan — a pure function so the
//! clear semantics are unit-tested without an LSP transport (the JSON-RPC
//! harness is deferred to the first interactive feature; recorded in the
//! v0.24 proposal).

use std::collections::{HashMap, HashSet};

use tower_lsp::lsp_types::{Diagnostic, Url};

/// Compute the publishes for one analysis round: every URI with new
/// diagnostics, **plus an empty publish for every URI that carried
/// diagnostics last round and no longer does** (the clear). Returns the
/// publish list and the next round's dirty set.
pub fn publish_plan(
    previously_dirty: &HashSet<Url>,
    new_by_uri: HashMap<Url, Vec<Diagnostic>>,
) -> (Vec<(Url, Vec<Diagnostic>)>, HashSet<Url>) {
    let mut publishes: Vec<(Url, Vec<Diagnostic>)> = Vec::new();
    let mut dirty: HashSet<Url> = HashSet::new();
    for (uri, diags) in new_by_uri {
        if !diags.is_empty() {
            dirty.insert(uri.clone());
            publishes.push((uri, diags));
        } else if previously_dirty.contains(&uri) {
            // Newly clean: clear.
            publishes.push((uri, Vec::new()));
        }
    }
    // Previously-dirty files that vanished from the analysis entirely
    // (deleted, renamed) also clear.
    let analysed: HashSet<&Url> = publishes.iter().map(|(u, _)| u).collect();
    let mut gone: Vec<Url> = previously_dirty
        .iter()
        .filter(|u| !dirty.contains(*u) && !analysed.contains(u))
        .cloned()
        .collect();
    gone.sort_by(|a, b| a.as_str().cmp(b.as_str()));
    for uri in gone {
        publishes.push((uri, Vec::new()));
    }
    (publishes, dirty)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn uri(s: &str) -> Url {
        Url::parse(&format!("file:///{s}")).unwrap()
    }
    fn diag(msg: &str) -> Diagnostic {
        Diagnostic {
            message: msg.to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn publishes_new_and_clears_fixed() {
        let prev: HashSet<Url> = [uri("a.karn"), uri("b.karn")].into_iter().collect();
        let mut new = HashMap::new();
        new.insert(uri("a.karn"), vec![diag("still broken")]);
        new.insert(uri("b.karn"), vec![]); // fixed
        new.insert(uri("c.karn"), vec![]); // was never dirty — no publish

        let (publishes, dirty) = publish_plan(&prev, new);
        let by: HashMap<_, _> = publishes
            .iter()
            .map(|(u, d)| (u.clone(), d.len()))
            .collect();
        assert_eq!(by.get(&uri("a.karn")), Some(&1), "still-broken republished");
        assert_eq!(
            by.get(&uri("b.karn")),
            Some(&0),
            "fixed file gets an empty publish"
        );
        assert!(
            !by.contains_key(&uri("c.karn")),
            "never-dirty clean file is not published"
        );
        assert!(dirty.contains(&uri("a.karn")) && !dirty.contains(&uri("b.karn")));
    }

    #[test]
    fn vanished_files_clear() {
        let prev: HashSet<Url> = [uri("gone.karn")].into_iter().collect();
        let (publishes, dirty) = publish_plan(&prev, HashMap::new());
        assert_eq!(publishes, vec![(uri("gone.karn"), Vec::new())]);
        assert!(dirty.is_empty());
    }

    #[test]
    fn newly_broken_file_enters_the_dirty_set() {
        let prev = HashSet::new();
        let mut new = HashMap::new();
        new.insert(uri("a.karn"), vec![diag("boom")]);
        let (publishes, dirty) = publish_plan(&prev, new);
        assert_eq!(publishes.len(), 1);
        assert!(dirty.contains(&uri("a.karn")));
    }
}
