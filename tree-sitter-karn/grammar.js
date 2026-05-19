/**
 * @file Tree-sitter grammar for Karn (v0–v0.5).
 *
 * Covers the syntactic surface defined by karn-mvp-grammar.md and the
 * v0.1–v0.5 deltas. Implements the highlighting / structural shape the
 * editor needs; semantic rules (type checking, exhaustiveness, effect
 * propagation, `given` matching) are intentionally left to the LSP.
 *
 * The grammar is permissive in the places where the type checker would
 * reject code anyway — e.g., `capability` declarations parse inside any
 * declaration body; the LSP surfaces the placement error.
 *
 * @author Karn project
 * @license see project root
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

const PREC = {
  or: 1,
  and: 2,
  cmp: 3,
  rel: 4,
  add: 5,
  mul: 6,
  unary: 7,
  postfix: 8,
  is: 4,
};

module.exports = grammar({
  name: "karn",

  externals: ($) => [$.doc_block],

  extras: ($) => [/\s+/, $.line_comment, $.doc_block],

  // The DSL allows reserved words to be referenced inside specific rules via
  // tokens; we declare keywords so they take precedence over `identifier`.
  word: ($) => $.identifier,

  conflicts: ($) => [],

  rules: {
    // -- Top level --

    source_file: ($) => choice($.commons_decl, $.context_decl),

    commons_decl: ($) =>
      seq(
        "commons",
        field("name", $.qualified_name),
        choice(
          seq("{", repeat($._commons_body_item), "}"),
          // Fragment form: header followed by items to EOF.
          repeat($._commons_body_item),
        ),
      ),

    context_decl: ($) =>
      seq(
        "context",
        field("name", $.qualified_name),
        choice(
          seq("{", repeat($._context_body_item), "}"),
          repeat($._context_body_item),
        ),
      ),

    qualified_name: ($) => sep1($.identifier, "."),

    _commons_body_item: ($) =>
      choice(
        $.uses_decl,
        $.type_decl,
        $.fn_decl,
        // Permissive: capability/service/etc. can syntactically appear
        // anywhere — the LSP reports semantic placement errors.
        $.capability_decl,
        $.provider_decl,
        $.service_decl,
        $.agent_decl,
      ),

    _context_body_item: ($) =>
      choice(
        $.uses_decl,
        $.consumes_decl,
        $.exports_decl,
        $.type_decl,
        $.fn_decl,
        $.capability_decl,
        $.provider_decl,
        $.service_decl,
        $.agent_decl,
      ),

    // -- Headers / clauses --

    uses_decl: ($) => seq("uses", field("target", $.qualified_name)),
    consumes_decl: ($) =>
      seq("consumes", field("target", $.qualified_name)),
    exports_decl: ($) =>
      seq(
        "exports",
        field("visibility", choice("opaque", "transparent")),
        "{",
        optional(sep1(field("name", $.identifier), ",")),
        optional(","),
        "}",
      ),

    // -- Type declarations --

    type_decl: ($) =>
      seq(
        "type",
        field("name", $.identifier),
        "=",
        field("body", $._type_body),
      ),

    _type_body: ($) =>
      choice(
        $.opaque_type,
        $.refined_type,
        $.record_type,
        $.sum_type,
        $.enum_type,
      ),

    opaque_type: ($) =>
      seq(
        "opaque",
        field("base", $._base_type),
        optional(seq("where", field("refinement", $.refinement))),
      ),

    refined_type: ($) =>
      prec(
        1,
        seq(
          field("base", $._base_type),
          optional(seq("where", field("refinement", $.refinement))),
        ),
      ),

    record_type: ($) =>
      seq(
        "{",
        optional(sep1($.record_field, ",")),
        optional(","),
        "}",
      ),

    record_field: ($) =>
      seq(
        field("name", $.identifier),
        ":",
        field("type", $._type_ref),
        optional(seq("where", field("refinement", $.refinement))),
      ),

    sum_type: ($) => prec.right(repeat1($.sum_variant)),
    sum_variant: ($) =>
      seq(
        "|",
        field("name", $.constant_name),
        optional(
          seq(
            "(",
            optional(sep1($.variant_payload_field, ",")),
            optional(","),
            ")",
          ),
        ),
      ),
    variant_payload_field: ($) =>
      seq(
        field("name", $.identifier),
        ":",
        field("type", $._type_ref),
      ),

    enum_type: ($) =>
      seq(
        "enum",
        "{",
        optional(sep1(field("variant", $.constant_name), ",")),
        optional(","),
        "}",
      ),

    refinement: ($) => sep1($._refinement_pred, "and"),
    _refinement_pred: ($) =>
      choice(
        $.pred_call,
        $.pred_atom,
      ),
    pred_call: ($) =>
      seq(field("name", $.predicate_name), "(", optional(sep1($._pred_arg, ",")), ")"),
    pred_atom: ($) => $.predicate_name,
    predicate_name: ($) =>
      choice(
        "Matches",
        "InRange",
        "MinLength",
        "MaxLength",
        "Length",
        "NonNegative",
        "Positive",
        "NonEmpty",
      ),
    _pred_arg: ($) => choice($.number_literal, $.string_literal),

    _base_type: ($) => $.base_type,
    base_type: () => choice("Int", "String", "Bool"),

    _type_ref: ($) =>
      choice(
        $._base_type,
        $.unit_type,
        $.validation_error_type,
        $.generic_type_ref,
        $.identifier,
      ),

    unit_type: () => seq("(", ")"),
    validation_error_type: () => "ValidationError",
    generic_type_ref: ($) =>
      seq(
        field(
          "name",
          choice(
            alias("Result", $.builtin_type),
            alias("Option", $.builtin_type),
            alias("Effect", $.builtin_type),
          ),
        ),
        "[",
        sep1(field("arg", $._type_ref), ","),
        "]",
      ),

    // -- Function declarations --

    fn_decl: ($) =>
      seq(
        "fn",
        field("name", choice($.method_name, $.identifier)),
        "(",
        optional($._params),
        ")",
        "->",
        field("return_type", $._type_ref),
        field("body", $.block),
      ),
    method_name: ($) =>
      seq(field("type", $.identifier), ".", field("method", $.identifier)),

    _params: ($) =>
      seq(
        choice($.self_param, $.param),
        repeat(seq(",", $.param)),
        optional(","),
      ),
    self_param: () => "self",
    param: ($) =>
      seq(
        field("name", $.identifier),
        ":",
        field("type", $._type_ref),
      ),

    // -- v0.5: capabilities, providers, services, agents --

    capability_decl: ($) =>
      seq(
        "capability",
        field("name", $.identifier),
        "{",
        repeat($.capability_op),
        "}",
      ),
    capability_op: ($) =>
      seq(
        "fn",
        field("name", $.identifier),
        "(",
        optional(sep1($.param, ",")),
        optional(","),
        ")",
        "->",
        field("return_type", $._type_ref),
      ),

    provider_decl: ($) =>
      seq(
        "provides",
        field("capability", $.identifier),
        "=",
        field("provider", $.identifier),
        "{",
        repeat($.provider_op),
        "}",
      ),
    provider_op: ($) =>
      seq(
        "fn",
        field("name", $.identifier),
        "(",
        optional(sep1($.param, ",")),
        optional(","),
        ")",
        "->",
        field("return_type", $._type_ref),
        field("body", $.block),
      ),

    service_decl: ($) =>
      seq(
        "service",
        field("name", $.identifier),
        "{",
        repeat($.handler),
        "}",
      ),

    agent_decl: ($) =>
      seq(
        "agent",
        field("name", $.identifier),
        "{",
        field("key", $.key_decl),
        field("state", $.state_decl),
        repeat($.handler),
        "}",
      ),
    key_decl: ($) =>
      seq("key", field("name", $.identifier), ":", field("type", $._type_ref)),
    state_decl: ($) =>
      seq(
        "state",
        "{",
        optional(sep1($.record_field, ",")),
        optional(","),
        "}",
      ),

    handler: ($) =>
      seq(
        "on",
        "call",
        optional(field("method", $.identifier)),
        "(",
        optional(sep1($.param, ",")),
        optional(","),
        ")",
        "->",
        field("return_type", $._type_ref),
        optional(field("given", $.given_clause)),
        field("body", $.block),
      ),
    given_clause: ($) =>
      seq("given", sep1(field("capability", $.identifier), ",")),

    // -- Block & statements --

    block: ($) =>
      seq("{", repeat($._statement), field("tail", $._expression), "}"),

    _statement: ($) => choice($.let_stmt, $.effect_let_stmt, $.commit_stmt),

    let_stmt: ($) =>
      seq(
        "let",
        field("name", $.identifier),
        optional(seq(":", field("type", $._type_ref))),
        "=",
        field("value", $._expression),
      ),
    effect_let_stmt: ($) =>
      seq(
        "let",
        field("name", $.identifier),
        optional(seq(":", field("type", $._type_ref))),
        "<-",
        field("value", $._expression),
      ),
    commit_stmt: ($) => seq("commit", field("value", $._expression)),

    // -- Expressions --

    _expression: ($) =>
      choice(
        $.if_expr,
        $.match_expr,
        $.is_expr,
        $.binary_expr,
        $.unary_expr,
        $._primary,
      ),

    if_expr: ($) =>
      seq(
        "if",
        field("cond", $._expression),
        field("then", $.block),
        "else",
        field("else", choice($.if_expr, $.block)),
      ),

    match_expr: ($) =>
      seq(
        "match",
        field("disc", $._expression),
        "{",
        repeat($.match_arm),
        "}",
      ),
    match_arm: ($) =>
      prec(
        1,
        seq(
          field("pattern", $._pattern),
          "=>",
          field("body", choice($.block, $._expression)),
          ",",
        ),
      ),

    _pattern: ($) => choice($.wildcard_pattern, $.variant_pattern),
    wildcard_pattern: () => "_",
    variant_pattern: ($) =>
      prec.right(
        seq(
          optional(seq(field("type", $.identifier), ".")),
          field("variant", $.constant_name),
          optional(
            seq(
              "(",
              optional(sep1($._pattern_binding, ",")),
              optional(","),
              ")",
            ),
          ),
        ),
      ),
    _pattern_binding: ($) =>
      choice(
        $.named_binding,
        $.positional_binding,
      ),
    named_binding: ($) =>
      seq(field("field", $.identifier), ":", field("name", choice($.identifier, "_"))),
    positional_binding: ($) => choice($.identifier, "_"),

    is_expr: ($) =>
      prec.left(
        PREC.is,
        seq(field("value", $._expression), "is", field("pattern", $._pattern)),
      ),

    binary_expr: ($) =>
      choice(
        prec.left(PREC.or, seq($._expression, "||", $._expression)),
        prec.left(PREC.and, seq($._expression, "&&", $._expression)),
        prec.left(PREC.cmp, seq($._expression, choice("==", "!="), $._expression)),
        prec.left(
          PREC.rel,
          seq($._expression, choice("<", "<=", ">", ">="), $._expression),
        ),
        prec.left(PREC.add, seq($._expression, choice("+", "-"), $._expression)),
        prec.left(PREC.mul, seq($._expression, choice("*", "/"), $._expression)),
      ),

    unary_expr: ($) =>
      prec.right(PREC.unary, seq(choice("!", "-"), $._expression)),

    _primary: ($) =>
      choice(
        $.paren_expr,
        $.method_call,
        $.field_access,
        $.constructor_call,
        $.call,
        $.record_construction,
        $.record_spread,
        $.question_expr,
        $.ok_expr,
        $.err_expr,
        $.some_expr,
        $.none_expr,
        $.effect_pure_expr,
        $.block,
        $.number_literal,
        $.string_literal,
        $.boolean_literal,
        $.unit_literal,
        $.self_expr,
        $.identifier,
      ),

    paren_expr: ($) => seq("(", $._expression, ")"),

    method_call: ($) =>
      prec.left(
        PREC.postfix,
        seq(
          field("receiver", $._primary),
          ".",
          field("method", $.identifier),
          "(",
          optional(sep1(field("arg", $._expression), ",")),
          optional(","),
          ")",
        ),
      ),

    field_access: ($) =>
      prec.left(
        PREC.postfix,
        seq(field("receiver", $._primary), ".", field("field", $.identifier)),
      ),

    constructor_call: ($) =>
      prec.left(
        PREC.postfix,
        seq(
          field("type", $.identifier),
          ".",
          field("method", choice($.identifier, $.constant_name)),
          "(",
          optional(sep1(field("arg", $._expression), ",")),
          optional(","),
          ")",
        ),
      ),

    call: ($) =>
      prec.left(
        PREC.postfix,
        seq(
          field("name", $.identifier),
          "(",
          optional(sep1(field("arg", $._expression), ",")),
          optional(","),
          ")",
        ),
      ),

    record_construction: ($) =>
      prec(
        2,
        seq(
          field("type", $.identifier),
          "{",
          optional(sep1($.field_init, ",")),
          optional(","),
          "}",
        ),
      ),
    field_init: ($) =>
      choice(
        seq(field("name", $.identifier), ":", field("value", $._expression)),
        field("shorthand", $.identifier),
      ),

    record_spread: ($) =>
      choice(
        seq(
          field("type", $.identifier),
          "{",
          "...",
          field("base", $._expression),
          repeat(seq(",", $.field_init)),
          optional(","),
          "}",
        ),
        seq(
          "{",
          "...",
          field("base", $._expression),
          repeat(seq(",", $.field_init)),
          optional(","),
          "}",
        ),
      ),

    question_expr: ($) =>
      prec.left(PREC.postfix, seq($._expression, "?")),

    ok_expr: ($) => seq("Ok", "(", $._expression, ")"),
    err_expr: ($) => seq("Err", "(", $._expression, ")"),
    some_expr: ($) => seq("Some", "(", $._expression, ")"),
    none_expr: () => "None",
    effect_pure_expr: ($) =>
      seq("Effect", ".", "pure", "(", $._expression, ")"),

    self_expr: () => "self",

    // -- Tokens --

    identifier: () => /[A-Za-z][A-Za-z0-9_]*/,

    // Constant-style names (capitalised idents used as variant names).
    // Tree-sitter cannot enforce capitalisation at the lex level without
    // overshadowing `identifier`; we use a regex.
    constant_name: () => /[A-Z][A-Za-z0-9_]*/,

    number_literal: () => /[0-9]+/,
    string_literal: () =>
      seq(
        '"',
        repeat(choice(/[^"\\\n]/, /\\[nt"\\]/)),
        '"',
      ),
    boolean_literal: () => choice("true", "false"),
    unit_literal: () => seq("(", ")"),

    // `--` line comment. The external scanner consumes `---+`-starting
    // lines as `doc_block` tokens before the regex tokenizer runs, so
    // line_comment sees only `--` (or `-` chars followed by a non-third
    // dash sequence that's already been gobbled by the external scanner).
    line_comment: () => token(seq("--", /[^\n]*/)),

    // `doc_block` is provided by the external scanner — see src/scanner.c.
    // The grammar references it via the `externals` array above.
  },
});

function sep1(rule, separator) {
  return seq(rule, repeat(seq(separator, rule)));
}
