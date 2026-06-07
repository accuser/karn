# §3 Lexical grammar

The lexical grammar defines Karn's terminals: the tokens a source text is divided
into, and the trivia discarded between them. Each production below is generated
from the grammar ([§2.1](conventions.md)); this chapter states only the
**syntactic** facts. Constraints beyond lexing (for example, the admissible range
of a literal) are well-formedness rules and are deferred to §5.

## §3.1 Identifiers and names

### §3.1.1 identifier

{{#grammar identifier}}

A letter followed by letters, digits, or underscores. Identifiers name
declarations, parameters, fields, and bindings. A source word that matches a
[keyword](../reference/keywords.md) is lexed as that keyword, not as an
identifier.

### §3.1.2 constant_name

{{#grammar constant_name}}

An upper-case-initial name. Constant names denote sum-type variants and enum
constants.

## §3.2 Literals

### §3.2.1 number_literal

{{#grammar number_literal}}

A run of decimal digits. A number literal is unsigned; a leading `-` is the unary
negation operator ([§4.6](syntactic-grammar.md)), not part of the token.

### §3.2.2 string_literal

{{#grammar string_literal}}

A double-quoted string. The escape sequences `\n`, `\t`, `\"`, and `\\` are
recognised; an unescaped newline does not appear within the token.

### §3.2.3 boolean_literal

{{#grammar boolean_literal}}

The two `Bool` values, `true` and `false`.

### §3.2.4 unit_literal

{{#grammar unit_literal}}

The unit value `()` — the single value of the unit type. It is lexically the
empty parenthesis pair.

## §3.3 Comments and doc-blocks

### §3.3.1 line_comment

{{#grammar line_comment}}

A comment from `--` to the end of the line. Karn uses `--`, never `//`. Line
comments are trivia ([§3.4](#34-trivia)).

### §3.3.2 doc-blocks

A **doc-block** is a `--- … ---` documentation block. It is an *external token*:
it is not a grammar rule but a terminal recognised by the lexer and attached to
the declaration that follows it. Like comments and whitespace, a doc-block is
trivia ([§3.4](#34-trivia)).

## §3.4 Trivia

Between tokens the lexer discards **trivia**: whitespace (`/\s+/`), line comments
([§3.3.1](#331-line_comment)), and doc-blocks ([§3.3.2](#332-doc-blocks)). Trivia
is insignificant to the syntactic grammar; it does not appear in the productions
of §4. The complete token-and-trivia summary is part of the grammar appendix
([§11](grammar-appendix.md)).
