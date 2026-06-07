//! `mdbook-karn-grammar` — an mdBook preprocessor that embeds a single grammar
//! production into a page by name.
//!
//! In any chapter, a line whose trimmed content is exactly `{{#grammar <rule>}}`
//! is replaced with an `ebnf` fenced block containing that production, rendered
//! from `tree-sitter-karn/src/grammar.json` via the `karn-grammar` crate. The
//! production therefore cannot drift from the parser or from the full grammar
//! appendix. An unknown rule fails the build loudly.
//!
//! We emit `ebnf` (not `karn`) so the result composes with the `karn-highlight`
//! preprocessor and the doc-example gate regardless of preprocessor ordering.
//!
//! Protocol (mdBook preprocessor):
//!   * `mdbook-karn-grammar supports <renderer>` → exit 0 iff supported.
//!   * otherwise: stdin is `[context, book]` JSON; stdout is the modified book.

use std::io::Read;
use std::path::Path;
use std::process::exit;

use serde_json::Value;

/// The grammar path relative to the book root when none is configured.
const DEFAULT_GRAMMAR: &str = "../tree-sitter-karn/src/grammar.json";

/// Rewrite every `{{#grammar <rule>}}` line in a chapter's Markdown into an
/// `ebnf` fenced block holding that production. Other lines are left untouched.
/// Exits non-zero on an unknown rule so a typo fails the build.
fn process_markdown(content: &str, grammar_json: &str) -> String {
    let mut out = String::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(rule) = trimmed
            .strip_prefix("{{#grammar ")
            .and_then(|rest| rest.strip_suffix("}}"))
        {
            let rule = rule.trim();
            match karn_grammar::render_rule(grammar_json, rule) {
                Ok(production) => {
                    out.push_str("```ebnf\n");
                    out.push_str(&format!("{rule} ::= {production}\n"));
                    out.push_str("```\n");
                }
                Err(e) => {
                    eprintln!("mdbook-karn-grammar: {e}");
                    exit(1);
                }
            }
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}

/// Recursively transform every chapter's content in the book's section list.
fn process_items(items: &mut Vec<Value>, grammar_json: &str) {
    for item in items {
        if let Some(chapter) = item.get_mut("Chapter").and_then(Value::as_object_mut) {
            if let Some(content) = chapter.get("content").and_then(Value::as_str) {
                let rewritten = process_markdown(content, grammar_json);
                chapter.insert("content".to_string(), Value::String(rewritten));
            }
            if let Some(sub) = chapter.get_mut("sub_items").and_then(Value::as_array_mut) {
                process_items(sub, grammar_json);
            }
        }
    }
}

/// Read the grammar JSON named by the preprocessor context: the configured
/// `grammar` path (or the default), resolved relative to the book `root`.
fn load_grammar(context: &Value) -> String {
    let root = context.get("root").and_then(Value::as_str).unwrap_or(".");
    let rel = context
        .get("config")
        .and_then(|c| c.get("preprocessor"))
        .and_then(|p| p.get("karn-grammar"))
        .and_then(|g| g.get("grammar"))
        .and_then(Value::as_str)
        .unwrap_or(DEFAULT_GRAMMAR);
    let path = Path::new(root).join(rel);
    match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!(
                "mdbook-karn-grammar: cannot read grammar at {}: {e}",
                path.display()
            );
            exit(1);
        }
    }
}

/// Transform a parsed `[context, book]` value in place.
fn process_book(parsed: &mut Value) {
    let grammar_json = load_grammar(&parsed[0]);
    let book = &mut parsed[1];
    if let Some(sections) = book.get_mut("sections").and_then(Value::as_array_mut) {
        process_items(sections, &grammar_json);
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    // `supports <renderer>`: we only rewrite HTML output.
    if args.len() >= 3 && args[1] == "supports" {
        exit(if args[2] == "html" { 0 } else { 1 });
    }

    let mut input = String::new();
    if std::io::stdin().read_to_string(&mut input).is_err() {
        eprintln!("mdbook-karn-grammar: failed to read stdin");
        exit(1);
    }
    let mut parsed: Value = match serde_json::from_str(&input) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("mdbook-karn-grammar: invalid preprocessor input: {e}");
            exit(1);
        }
    };

    process_book(&mut parsed);

    // Input is `[context, book]`; we emit the transformed book.
    match serde_json::to_string(&parsed[1]) {
        Ok(s) => println!("{s}"),
        Err(e) => {
            eprintln!("mdbook-karn-grammar: failed to serialise book: {e}");
            exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn directive_renders_production_in_ebnf_fence() {
        let root = env!("CARGO_MANIFEST_DIR");
        let mut parsed = json!([
            {
                "root": root,
                "config": {
                    "preprocessor": {
                        "karn-grammar": { "grammar": "../tree-sitter-karn/src/grammar.json" }
                    }
                }
            },
            {
                "sections": [
                    {
                        "Chapter": {
                            "content": "intro\n{{#grammar match_arm}}\noutro\n",
                            "sub_items": []
                        }
                    }
                ]
            }
        ]);

        process_book(&mut parsed);

        let content = parsed[1]["sections"][0]["Chapter"]["content"]
            .as_str()
            .unwrap();
        assert!(
            content.contains("```ebnf\n"),
            "missing ebnf fence:\n{content}"
        );
        assert!(
            content.contains("match_arm ::= _pattern \"=>\" _expression \",\"?"),
            "missing rendered production:\n{content}"
        );
        // Surrounding lines are preserved.
        assert!(content.contains("intro\n"));
        assert!(content.contains("outro\n"));
    }
}
