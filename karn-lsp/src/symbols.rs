//! Symbol lookups for hover and go-to-definition.
//!
//! Walks the parsed AST of a single file to find declarations matching a
//! given name. Cross-file resolution (across `uses` / `consumes` boundaries)
//! is deferred to a later tooling increment — the search currently scopes to
//! the file under the cursor.

use karnc::ast::*;
use karnc::lexer::tokenize;
use karnc::parser::parse_unit_with_recovery;
use karnc::span::Span;

/// Return the source span of the declaration named `name` in the given
/// source text. Returns `None` if no declaration matches.
pub fn find_declaration_span(source: &str, name: &str) -> Option<Span> {
    let tokens = tokenize(source).ok()?;
    let (unit, _errs) = parse_unit_with_recovery(&tokens, source);
    let unit = unit?;
    let items: &[CommonsItem] = match &unit {
        SourceUnit::Commons(c) => &c.items,
        SourceUnit::Context(c) => &c.items,
    };
    for item in items {
        match item {
            CommonsItem::Type(t) if t.name.name == name => return Some(t.name.span),
            CommonsItem::Fn(f) if f.name.ident().name == name => return Some(f.name.ident().span),
            CommonsItem::Capability(c) if c.name.name == name => return Some(c.name.span),
            CommonsItem::Service(s) if s.name.name == name => return Some(s.name.span),
            CommonsItem::Agent(a) if a.name.name == name => return Some(a.name.span),
            CommonsItem::Provider(p) if p.provider_name.name == name => {
                return Some(p.provider_name.span);
            }
            _ => {}
        }
    }
    None
}

/// Build a Markdown summary of a named declaration suitable for an LSP
/// hover response. Returns `None` if no declaration matches.
pub fn describe_symbol(source: &str, name: &str) -> Option<String> {
    let tokens = tokenize(source).ok()?;
    let (unit, _errs) = parse_unit_with_recovery(&tokens, source);
    let unit = unit?;
    let items: &[CommonsItem] = match &unit {
        SourceUnit::Commons(c) => &c.items,
        SourceUnit::Context(c) => &c.items,
    };
    for item in items {
        if let Some(summary) = describe_item(item, name) {
            return Some(summary);
        }
    }
    None
}

fn describe_item(item: &CommonsItem, name: &str) -> Option<String> {
    match item {
        CommonsItem::Type(t) if t.name.name == name => Some(describe_type(t)),
        CommonsItem::Fn(f) if f.name.ident().name == name => Some(describe_fn(f)),
        CommonsItem::Capability(c) if c.name.name == name => Some(describe_capability(c)),
        CommonsItem::Service(s) if s.name.name == name => Some(describe_service(s)),
        CommonsItem::Agent(a) if a.name.name == name => Some(describe_agent(a)),
        CommonsItem::Provider(p) if p.provider_name.name == name => Some(describe_provider(p)),
        _ => None,
    }
}

fn describe_type(t: &TypeDecl) -> String {
    let mut out = String::new();
    out.push_str("```karn\n");
    let body = match &t.body {
        TypeBody::Refined { base, .. } => format!("type {} = {}", t.name.name, base.name()),
        TypeBody::Opaque { base, .. } => format!("type {} = opaque {}", t.name.name, base.name()),
        TypeBody::Record(_) => format!("type {} = record", t.name.name),
        TypeBody::Sum(_) => format!("type {} = sum", t.name.name),
    };
    out.push_str(&body);
    out.push_str("\n```\n");
    if let Some(doc) = &t.documentation {
        out.push('\n');
        out.push_str(doc);
        out.push('\n');
    }
    out
}

fn describe_fn(f: &FnDecl) -> String {
    let mut out = String::new();
    out.push_str("```karn\n");
    out.push_str("fn ");
    out.push_str(&f.name.display());
    out.push('(');
    let mut parts: Vec<String> = Vec::new();
    if f.has_self {
        parts.push("self".into());
    }
    for p in &f.params {
        parts.push(format!("{}: {}", p.name.name, type_ref_str(&p.type_ref)));
    }
    out.push_str(&parts.join(", "));
    out.push_str(") -> ");
    out.push_str(&type_ref_str(&f.return_type));
    out.push_str("\n```\n");
    if let Some(doc) = &f.documentation {
        out.push('\n');
        out.push_str(doc);
        out.push('\n');
    }
    out
}

fn describe_capability(c: &CapabilityDecl) -> String {
    let mut out = String::new();
    out.push_str("```karn\ncapability ");
    out.push_str(&c.name.name);
    out.push_str(" {\n");
    for op in &c.ops {
        out.push_str("\tfn ");
        out.push_str(&op.name.name);
        out.push('(');
        let parts: Vec<String> = op
            .params
            .iter()
            .map(|p| format!("{}: {}", p.name.name, type_ref_str(&p.type_ref)))
            .collect();
        out.push_str(&parts.join(", "));
        out.push_str(") -> ");
        out.push_str(&type_ref_str(&op.return_type));
        out.push('\n');
    }
    out.push_str("}\n```\n");
    if let Some(doc) = &c.documentation {
        out.push('\n');
        out.push_str(doc);
        out.push('\n');
    }
    out
}

fn describe_service(s: &ServiceDecl) -> String {
    let mut out = format!("```karn\nservice {}\n```\n", s.name.name);
    if let Some(doc) = &s.documentation {
        out.push('\n');
        out.push_str(doc);
        out.push('\n');
    }
    out.push_str(&format!("\n{} handler(s).", s.handlers.len()));
    out
}

fn describe_agent(a: &AgentDecl) -> String {
    let mut out = format!(
        "```karn\nagent {} {{\n\tkey {}: {}\n\tstate {{ {} field(s) }}\n}}\n```\n",
        a.name.name,
        a.key_name.name,
        type_ref_str(&a.key_type),
        a.state_fields.len(),
    );
    if let Some(doc) = &a.documentation {
        out.push('\n');
        out.push_str(doc);
        out.push('\n');
    }
    out
}

fn describe_provider(p: &ProviderDecl) -> String {
    let mut out = format!(
        "```karn\nprovides {} = {}\n```\n",
        p.capability.name, p.provider_name.name
    );
    if let Some(doc) = &p.documentation {
        out.push('\n');
        out.push_str(doc);
        out.push('\n');
    }
    out
}

fn type_ref_str(t: &TypeRef) -> String {
    match t {
        TypeRef::Base(b, _) => b.name().to_string(),
        TypeRef::Named(id) => id.name.clone(),
        TypeRef::Result(a, b, _) => format!("Result[{}, {}]", type_ref_str(a), type_ref_str(b)),
        TypeRef::Option(t, _) => format!("Option[{}]", type_ref_str(t)),
        TypeRef::Effect(t, _) => format!("Effect[{}]", type_ref_str(t)),
        TypeRef::ValidationError(_) => "ValidationError".to_string(),
        TypeRef::Unit(_) => "()".to_string(),
    }
}
