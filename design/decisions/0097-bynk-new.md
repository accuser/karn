# 0097 — `bynk new`: scaffold a runnable project, offline

- **Status:** Accepted (v0.58)
- **Realises:** the v0.58 `bynk new` proposal (consumed and removed on landing,
  per the proposals lifecycle; history in `git log -- design/proposals/`).
- **Relates:** [[0083]] (the `bynk` driver, thin orchestrator), [[0086]]
  (first-party sources as embedded, testable files), [[0096]] (`bynk dev`, which
  serves what `new` writes).

## Context

Starting a Bynk project was undocumented archaeology: you had to already know
that a `bynk.toml` marks the root, that a source file's path must match its
qualified name (`context links` ⇒ `src/links.bynk`), and what a minimal
*compiling* unit looks like. `new` is the missing first link of the driver arc
`doctor → new → dev` ([[0083]]): it writes a **complete, runnable** single-context
HTTP service that `bynk dev` ([[0096]]) serves unmodified — closing a
three-command on-ramp (*is my machine ready* → *make me something* → *run it*).

The decisions below are the defining calls — *what* `new` writes, *why* it
touches no toolchain, and how the project name is validated. No language surface
changes; this is driver tooling.

## Decision

**(D2) Scaffold a runnable service, not an empty project.** `new <path>` writes a
single-context `from http` service — `bynk.toml`, `.gitignore`, and
`src/<name>.bynk` — chosen so `bynk dev` serves it with no edits. That runnable
loop is what makes `new` worth more than `mkdir` + a heredoc; an empty project
would leave the newcomer facing the same blank-file problem `new` exists to
solve. The starter is the single-file analogue of `examples/hello-world`. A
template **menu** (`--template lib|service|agent`) is deferred: it front-loads a
taxonomy decision better made once the example library has settled, and there is
no real second template to offer yet.

**(D2, mechanism) The template is an embedded, compile-tested source.** The
starter, manifest, and `.gitignore` are real files under `bynk/src/templates/`,
embedded via `include_str!` ([[0086]] precedent), carrying a sentinel
`appname` identifier substituted for the project name at write time. A standing
test renders the starter **with a non-default name** and asserts it **compiles**
(via `compile_project`, the in-process path) and is **`bynk-fmt`-clean** — so the
scaffold can never rot into something that doesn't build, and the substitution
step itself is covered, not just drift in the canonical template. This is the
same guard the first-party sources already carry.

**(D4) No toolchain at `new` time.** `new` shells nothing, compiles nothing, and
reads no network — pure, offline `std::fs` file-writing. It is the step you run
*before* you have a toolchain; coupling it to `bynkc` resolution (as `dev`
pre-flights) would make the first command fail for exactly the person it is meant
to help. The starter's correctness is guaranteed at *our* build time (the
compile-tested template), not at the user's `new` time; `doctor` is the separate,
suggested environment check, pointed at from the success message.

**(D3) Validate the name as a real Bynk identifier; fail with a fix-it.** The
project name feeds two sinks with different rules: `[project] name` is a liberal
string (`examples/feature-flags` carries `name = "feature-flags"`, dash and all),
but the starter's **context** identifier must be a legal Bynk name and align with
its file path or the compiler raises `bynk.project.inconsistent_commons_name`.
`new` could split these (a liberal project name beside a separately-derived
identifier), but **chooses one validated identifier for both** — a scaffold that
quietly holds two names is a reconciliation the newcomer shouldn't have to do.
The name is validated by the **real lexer** (`tokenize` ⇒ exactly one `Ident`
token), so the rule tracks the language exactly: a dash, dot, leading digit, or
reserved keyword is rejected. On a mismatch `new` **fails with a fix-it** naming
`--name` rather than silently mangling (a silent `my_app` would surprise later at
`inconsistent_commons_name`); `--name` is also the escape hatch for anyone who
deliberately wants the directory and identifier to differ.

**(D1, posture) `new <path>`, not `init`.** `new <path>` (make a directory) is
the dominant zero-to-one motion and keeps the conflict policy simple — the target
is ours to create. `init` (scaffold *into* an existing directory) is a distinct
safety problem (which files may coexist?) deserving its own slice; the
scaffolding logic is shared, so `init` is later mostly a target-dir + empty-check
policy, not a rewrite.

**(D5, posture) Refuse a non-empty target; never overwrite.** If the target
exists and is non-empty, `new` fails before writing anything and touches nothing
— the look-before-you-leap default for a command whose whole job is to write
files. An existing *empty* directory is fine (the common "I just `mkdir`ed it"
case), and "empty" **ignores VCS/OS cruft** (`.git`, `.gitignore`, `.DS_Store`,
`.hg`, `.svn`) so a freshly `git init`ed or Finder-touched directory still counts
as empty (as `cargo` does).

**(D6, posture) A `.gitignore`, no `git init`.** The scaffold's only documented
build workflow is `bynk dev`, which writes everything under `.bynk/` (including
wrangler's local `.wrangler/` state, at `.bynk/dev/workers/<ctx>/.wrangler` —
inside the already-ignored tree). So the project `.gitignore` is exactly **one
entry, `/.bynk`** — what the scaffold's workflow produces, ignored from the first
`dev` run and first commit. The examples' broader four-entry ignore
(`out/ out-js/ node_modules/ .wrangler/`) covers the manual `bynkc compile
--output out` + local-`npm` workflow the scaffold doesn't lead into; ignoring
paths nothing writes is noise. `new` does **not** run `git init` — a second tool
dependency and a VCS opinion the thin driver needn't hold; a repo-less scaffold
drops cleanly into an existing repo.

## Consequences

The zero-to-one step is no longer archaeology: `bynk new hello && cd hello &&
bynk dev` is a working service to start editing, and the three-command arc
`doctor → new → dev` is complete. Because `new` is offline and dependency-free,
it works before any of `bynkc`, Node, or `wrangler` is installed — the true
first step. The deterministic surface (the "next steps" success message and the
clobber / invalid-name failures) is golden-pinned in the style of [[0096]], and
the emitted scaffold is pinned by a golden tree with the starter additionally
compile-tested.

Deferred and logged as next intent: `init` (scaffold in place), `--template`
(a real second project shape), and in-project generators (`bynk new context …`)
— explicitly **project** scaffolding only here.
