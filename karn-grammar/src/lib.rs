//! Render the `tree-sitter-karn` grammar to EBNF.
//!
//! This crate is the single source of the grammar reference. It takes the
//! compiled grammar JSON (`tree-sitter-karn/src/grammar.json`) as input and is
//! otherwise location-agnostic, so the same renderer feeds both the full
//! appendix page ([`render_appendix`]) and the per-rule includes embedded in
//! curated reference pages ([`render_rule`]). Because both come from one
//! implementation, an embedded production cannot drift from the appendix.
//!
//! See `karnc/tests/grammar_reference.rs` (the appendix generator) and
//! `mdbook-karn-grammar` (the `{{#grammar <rule>}}` include preprocessor).

use std::error::Error;
use std::fmt;

use serde_json::Value;

/// An error rendering a grammar production.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GrammarError {
    /// The grammar JSON could not be parsed.
    Parse(String),
    /// `name` is not a top-level rule in the grammar.
    UnknownRule(String),
}

impl fmt::Display for GrammarError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GrammarError::Parse(e) => write!(f, "could not parse grammar JSON: {e}"),
            GrammarError::UnknownRule(name) => {
                write!(
                    f,
                    "unknown grammar rule `{name}` (not a top-level production)"
                )
            }
        }
    }
}

impl Error for GrammarError {}

/// Render a grammar node to EBNF text plus a precedence level:
/// 0 = choice (`a | b`), 1 = sequence (`a b`), 2 = atom / postfix (`x`, `(…)*`).
fn render(node: &Value) -> (String, u8) {
    match node.get("type").and_then(Value::as_str).unwrap_or("") {
        "SYMBOL" => (node["name"].as_str().unwrap_or("?").to_string(), 2),
        "STRING" => (format!("\"{}\"", node["value"].as_str().unwrap_or("")), 2),
        "PATTERN" => (format!("/{}/", node["value"].as_str().unwrap_or("")), 2),
        "BLANK" => ("ε".to_string(), 2),
        // Wrappers that don't affect the surface grammar: render their content.
        "PREC" | "PREC_LEFT" | "PREC_RIGHT" | "PREC_DYNAMIC" | "TOKEN" | "IMMEDIATE_TOKEN"
        | "FIELD" | "ALIAS" => render(&node["content"]),
        "REPEAT" => (format!("{}*", wrap_atom(&node["content"])), 2),
        "REPEAT1" => (format!("{}+", wrap_atom(&node["content"])), 2),
        "SEQ" => {
            let parts: Vec<String> = members(node).iter().map(|m| wrap(m, 1)).collect();
            (parts.join(" "), 1)
        }
        "CHOICE" => {
            let all = members(node);
            let has_blank = all
                .iter()
                .any(|m| m.get("type").and_then(Value::as_str) == Some("BLANK"));
            let non_blank: Vec<&Value> = all
                .iter()
                .filter(|m| m.get("type").and_then(Value::as_str) != Some("BLANK"))
                .collect();
            if has_blank {
                // An optional: `X?`.
                if non_blank.len() == 1 {
                    (format!("{}?", wrap_atom(non_blank[0])), 2)
                } else {
                    let inner: Vec<String> = non_blank.iter().map(|m| render(m).0).collect();
                    (format!("({})?", inner.join(" | ")), 2)
                }
            } else {
                let inner: Vec<String> = non_blank.iter().map(|m| render(m).0).collect();
                (inner.join(" | "), 0)
            }
        }
        other => (format!("/* {other} */"), 2),
    }
}

fn members(node: &Value) -> Vec<Value> {
    node["members"].as_array().cloned().unwrap_or_default()
}

/// Wrap so the result can be a postfix operand (`*`, `+`, `?`): needs an atom.
fn wrap_atom(node: &Value) -> String {
    wrap(node, 2)
}

/// Wrap `node`'s rendering in parens if its level is below `min`.
fn wrap(node: &Value, min: u8) -> String {
    let (s, level) = render(node);
    if level < min { format!("({s})") } else { s }
}

fn render_extra(node: &Value) -> String {
    match node.get("type").and_then(Value::as_str).unwrap_or("") {
        "SYMBOL" => format!("`{}`", node["name"].as_str().unwrap_or("?")),
        "PATTERN" => format!("`/{}/`", node["value"].as_str().unwrap_or("")),
        "STRING" => format!("`\"{}\"`", node["value"].as_str().unwrap_or("")),
        _ => "?".to_string(),
    }
}

/// Render the complete grammar reference page (`docs/src/reference/grammar.md`):
/// the generated-file header, the notation note, the full `ebnf` block of every
/// production, and the Tokens & trivia section.
pub fn render_appendix(grammar_json: &str) -> String {
    let grammar: Value = serde_json::from_str(grammar_json).expect("grammar.json parses");

    let mut out = String::new();
    out.push_str("# Grammar\n\n");
    out.push_str(
        "<!-- GENERATED FILE — do not edit by hand.\n     \
         Source: tree-sitter-karn/src/grammar.json, via karnc/tests/grammar_reference.rs.\n     \
         Regenerate with: KARN_BLESS=1 cargo test -p karnc --test grammar_reference -->\n\n",
    );
    out.push_str("The complete Karn grammar, generated from the `tree-sitter-karn` grammar.\n\n");
    out.push_str("**Notation.** ");
    out.push_str(
        "`\"x\"` a literal token · `/x/` a regular expression · `( … )?` optional · \
         `( … )*` zero or more · `( … )+` one or more · `a | b` choice · `ε` empty. \
         Rule names beginning with `_` are internal helper rules (inlined into the \
         syntax tree). `doc_block` is an external token — a `--- … ---` documentation \
         block.\n\n",
    );

    out.push_str("```ebnf\n");
    if let Some(rules) = grammar.get("rules").and_then(Value::as_object) {
        for (name, body) in rules {
            let (rendered, _) = render(body);
            out.push_str(&format!("{name} ::= {rendered}\n"));
        }
    }
    out.push_str("```\n\n");

    out.push_str("## Tokens & trivia\n\n");
    if let Some(word) = grammar.get("word").and_then(Value::as_str) {
        out.push_str(&format!("- **Word token:** `{word}`\n"));
    }
    if let Some(extras) = grammar.get("extras").and_then(Value::as_array) {
        let rendered: Vec<String> = extras.iter().map(render_extra).collect();
        out.push_str(&format!(
            "- **Ignored between tokens:** {}\n",
            rendered.join(", ")
        ));
    }
    if let Some(externals) = grammar.get("externals").and_then(Value::as_array) {
        let rendered: Vec<String> = externals.iter().map(render_extra).collect();
        out.push_str(&format!("- **External tokens:** {}\n", rendered.join(", ")));
    }

    out
}

/// Render a single top-level production's right-hand side, exactly as it appears
/// after `name ::= ` in the appendix's EBNF block. Prepend `"{name} ::= "` to
/// reconstruct the full production line.
///
/// Errors if the grammar JSON cannot be parsed, or if `name` is not a top-level
/// rule of the grammar.
pub fn render_rule(grammar_json: &str, name: &str) -> Result<String, GrammarError> {
    let grammar: Value =
        serde_json::from_str(grammar_json).map_err(|e| GrammarError::Parse(e.to_string()))?;
    let body = grammar
        .get("rules")
        .and_then(Value::as_object)
        .and_then(|rules| rules.get(name))
        .ok_or_else(|| GrammarError::UnknownRule(name.to_string()))?;
    Ok(render(body).0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn grammar_json() -> String {
        let path =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tree-sitter-karn/src/grammar.json");
        fs::read_to_string(path).expect("read grammar.json")
    }

    #[test]
    fn render_rule_known_rules() {
        let g = grammar_json();
        assert_eq!(
            render_rule(&g, "match_arm").unwrap(),
            "_pattern \"=>\" _expression \",\"?"
        );
        assert_eq!(
            render_rule(&g, "http_method").unwrap(),
            "\"GET\" | \"POST\" | \"PUT\" | \"PATCH\" | \"DELETE\""
        );
        // A more involved production exercises sequencing and optionals.
        assert_eq!(
            render_rule(&g, "agent_decl").unwrap(),
            "\"agent\" identifier \"{\" key_decl state_decl handler* \"}\""
        );
        assert!(render_rule(&g, "http_handler").is_ok());
    }

    #[test]
    fn render_rule_unknown_rule_errors() {
        let g = grammar_json();
        assert_eq!(
            render_rule(&g, "no_such_rule"),
            Err(GrammarError::UnknownRule("no_such_rule".to_string()))
        );
    }

    #[test]
    fn render_rule_invalid_json_errors() {
        assert!(matches!(
            render_rule("not json", "match_arm"),
            Err(GrammarError::Parse(_))
        ));
    }

    /// Pins the two renderers to one implementation: every top-level rule's
    /// reconstructed line must appear verbatim in the appendix.
    #[test]
    fn every_rule_matches_the_appendix() {
        let g = grammar_json();
        let appendix = render_appendix(&g);
        let grammar: Value = serde_json::from_str(&g).unwrap();
        let rules = grammar
            .get("rules")
            .and_then(Value::as_object)
            .expect("grammar has rules");
        for name in rules.keys() {
            let line = format!("{name} ::= {}", render_rule(&g, name).unwrap());
            assert!(
                appendix.contains(&line),
                "production for `{name}` not found in appendix:\n{line}"
            );
        }
    }
}
