# Docs review — trust fixes and the capability on-ramp

- **Status:** Draft (proposal). **Merging is approval to build.** *(Documentation-only
  increment. No grammar, compiler, emitter, or tooling change — every delta lands under
  `docs/src/` plus the repo `README.md`. No version bump and no release tag: docs work is
  non-versioned here, following the concern-first reorganisation precedent — proposal #115,
  merged as `docs: reorganise the Karn Book concern-first`, which carried no `vX.Y`.)*

## Context — the book is structurally strong but leaks trust

`docs/DOCS-REVIEW.md` (15 June 2026, reviewed against the v0.43 book) reaches a clear
verdict: the Karn Book commits properly to Diátaxis, the tutorial spine is concrete, and the
evaluator pages make an honest case. What costs it is a **small set of trust-eroding
inconsistencies** — places where the docs contradict themselves or point at things that no
longer exist. For a pre-1.0 language the evaluator's unspoken question is "is this serious
and maintained?", and these blemishes answer "not quite" louder than the prose answers "yes".

This increment consumes that review. It is deliberately **two-natured**, matching the
review's own "suggested order of attack":

- **Slice A — trust fixes (the afternoon).** Mechanical, high-confidence corrections that
  remove almost all of the "is this maintained?" friction: the stale roadmap, the dead README
  links, three code samples corrupted by the reorg's path rewrite, a leftover author comment,
  and one consistency pass on top-level wrapping.
- **Slice B — on-ramp structure (the valuable work).** Two additions that make the newcomer
  journey materially better: a capability-model explanation page, and a single whole-program
  "anatomy of a Karn service" showpiece.

The two slices are independent and may land as two PRs (recommended — Slice A is reviewable
in minutes and worth shipping immediately) or one. Nothing in Slice B depends on Slice A.

## Builds on (verified against `main` @ `586e89f`)

- **The review's structural claims check out.** `guides/effects-and-capabilities/index.md`
  has a **Do** list and *no* **Understand** section — it is the only guide section so shaped.
  `type-system/index.md` (Understand → philosophy + refined-literal admission), `program-
  structure/`, and `agents-and-state/` all open with an Understand page. So Priority 4's
  "mirror the other three sections" is a real, well-defined gap, not a matter of taste.
- **The changelog is genuinely current** (`docs/src/reference/changelog.md`, top entry v0.43
  string interpolation) — the roadmap contradiction in Priority 1 is *localised* to the
  "What's next" section of `about/versioning-and-roadmap.md`, not a project-wide staleness.
- **The uncorrupted `Mock[…]` form exists** (`tutorials/06-testing.md`,
  `Mock[ShortCode]("abc123")`), so Priority 3's three corruptions have a known-good target.
- **`appendix-version-history.md`** (`docs/src/spec/`) is the home the review proposes for the
  retired v0.19–v0.22 roadmap material.

## What changes, by priority

### Priority 1 — roadmap "What's next" is frozen ~24 increments back *(Slice A)*

`about/versioning-and-roadmap.md` says the book is written against v0.43, but its **What's
next** section (lines ~28–51) still reads "re-planned after v0.18", lists v0.19 Cloudflare
`Kv` as a recent milestone, marks **v0.20b as "next"**, and lists `Queue` under a *future*
"v0.22 — extend cloudflare". `Queue` ships **today** — full how-to (`guides/entry-points/
queue.md`) and reference (`reference/queue.md`), both in the present tense the book reserves
for "what compiles today". So shipped behaviour is masquerading as aspirational — the exact
inverse of the page's own stated rule.

**Change.** Rewrite **What's next** to start from the actual current edge (post-v0.43) and
relocate the v0.19–v0.22 material to where landed history belongs.

- **▸ [DECISION] Where does the historical material land, and what does "next" name?**
  - **(a, recommended) Move history to `appendix-version-history.md`; make "What's next"
    name *categories of intent*, not version numbers.** The roadmap drifted precisely because
    it pinned specific `vNN` milestones that then shipped. Naming themes ("comprehensive
    completion follow-ups", "marketplace distribution", "incremental recompute when scale
    demands") that are checkable against the queues but don't rot on each release breaks that
    failure mode. Source of truth for "what's next" = `design/karn-tooling-proposal-queue.md`
    + `design/karn-refactor-proposal-queue.md`, summarised — not duplicated — on the page.
  - **(b) Keep version-pinned milestones, just advance them to the real edge.** Honest today,
    but re-introduces the same staleness the moment the next increment ships. Rejected unless
    the page gains a CI currency check (out of scope here).

  This is the review's "highest-value single edit". Recommend (a).

### Priority 2 — dead README links and stale four-kinds framing *(Slice A)*

The reorg moved `how-to/` and `explanation/` into the concern-first `guides/` tree, but the
**repo `README.md`** — the first doc GitHub renders — still advertises the old shape:

- `README.md:101` → `docs/src/how-to/index.md` is **dead** → repoint to `guides/index.md`.
- `README.md:104` → `docs/src/explanation/index.md` is **dead**; there is no single drop-in
  target (explanation now lives inside each guide section, e.g. `type-system/philosophy.md`)
  → this bullet is **reworded**, not just repointed.
- `README.md:97–98` → surrounding prose still describes a four-way "Tutorials / How-to /
  Reference / Explanation" split → soften to the concern-first reality.

The same stale framing leaks into the book: the introduction landing copy (the review cites
`introduction.md:18–20`) links both **"How-to guides"** and **"understand the *why*? →
Explanation"** to the *same* URL (`guides/index.md`) — a reader told there are four kinds and
handed two identical links notices.

**Change.** Repoint/reword the two README bullets, soften the README's "organised along
Diátaxis lines" sentence, and give the introduction's "Explanation" pointer a real
destination.

- **▸ [DECISION] The introduction's "Explanation" pointer.**
  - **(a, recommended) Reword to reflect co-location** — "the *why* is woven into each guide
    section's Understand pages" — and link to one strong exemplar (`type-system/philosophy.md`)
    rather than implying a single Explanation hub that no longer exists. Truthful to the
    concern-first structure the project deliberately chose.
  - **(b) Point it at `how-these-docs-are-organised.md`.** Accurate but indirect — sends a
    reader wanting *the why of the language* to a page about *the why of the docs layout*.

  Recommend (a). (Confirm the exact introduction file/lines during implementation — the review
  cites `introduction.md:18–20`; the tree has `introduction/what-is-karn.md` and an
  `introduction/` index, so the precise anchor is verified before editing.)

### Priority 3 — three code samples corrupted by the reorg's path rewrite *(Slice A)*

The directory-rename pass rewrote text *inside fenced Karn code blocks*, so no link checker
flags it — but a newcomer copying the sample gets nonsense. The three (and the review states
these are the **only** remaining `how-to/`/`explanation/` occurrences in `docs/src/`):

| File | Is | Should be |
|---|---|---|
| `troubleshooting/mock-errors.md:36` | `Mock[Code](../how-to/troubleshooting/"abc")` | `Mock[Code]("abc")` |
| `guides/testing/write-tests.md:39` | `Mock[Quantity](../../how-to/testing/50)` | `Mock[Quantity](50)` |
| `guides/testing/philosophy.md:26` | `` `Mock[T](../../explanation/50)` `` | `` `Mock[T](50)` `` |

**Change.** Apply the three corrections. **Verification gate:** after the edit,
`rg -n 'how-to/|explanation/' docs/src/` must return **zero** hits — this closes the reorg out
cleanly and is the proof the corruption is fully swept (not just these three).

### Priority 4 — capabilities have no conceptual on-ramp *(Slice B)*

Capabilities / providers / `given` / adapters are Karn's hardest concept and biggest
departure from TypeScript, yet `effects-and-capabilities/` opens straight into *Compose a
provider* — "build one adapter out of others" — before anything explains what a capability or
provider *is*. The concepts are defined well, but only in `reference/capabilities.md`, which
is lookup material, not a learning path.

**Change.** Add **`guides/effects-and-capabilities/understand-the-capability-model.md`** as
the section's first entry, register it in `SUMMARY.md` immediately under the section index,
and add an **Understand** block to `effects-and-capabilities/index.md` (mirroring
`type-system/index.md`'s Understand/Do split). Scope of the new page: what an effect is and
why it is gated; what `given` declares; what a provider/adapter supplies; the host-boundary
seam — links *out* to `reference/capabilities.md` for the full surface rather than duplicating
it. This is the review's "single biggest structural gap for the newcomer journey".

- Folds in the smaller item **`Effect.pure(())` used before it's introduced**
  (`reference/capabilities.md:23`, `compose-a-provider.md`): the new page is the natural place
  to introduce the trivial-effect body once, plus a one-line glossary entry.

### Priority 5 — no whole program is ever shown in one piece *(Slice B)*

`what-is-karn.md`'s "idea in one example" is two three-line snippets; the only complete
program (the URL-shortener) is spread across separate tutorial steps. An evaluator can't judge
ergonomics/verbosity at a glance.

**Change.** Add a short **"anatomy of a Karn service"** showpiece — one complete, annotated
program (types + a context + a service + an agent wired together) near `what-is-karn.md`.

- **▸ [DECISION] New page vs. expanding `what-is-karn.md`.**
  - **(a, recommended) A new page** (`introduction/anatomy-of-a-service.md`) linked from
    `what-is-karn.md` and the tutorials index. Keeps `what-is-karn.md` skimmable; gives the
    showpiece a stable link evaluators can be sent to directly.
  - **(b) Inline into `what-is-karn.md`.** Risks bloating the page every newcomer hits first.

  Recommend (a). **Source the program from a compiled example, not hand-written** — reuse or
  add an entry under the worked-examples corpus and `{{#include}}` it, so `karnc test`/CI keeps
  it honest and it cannot rot. (The page is "optional but high-value"; if Slice B is itself
  sliced, this is the more deferrable half.)
- **Verification (cheap, do regardless):** the highest-impact "refused program + its
  diagnostic" payoffs (`why-karn-exists.md`, `the-agent-model.md`, the philosophy pages) are
  pulled via mdBook `{{#include}}` from `docs/diagnostics/`. Confirm **every include still
  resolves** — a silently broken include would gut the most persuasive pages. A `mdbook build`
  with `-D warnings` (or the existing doc-example gate) covers this; assert it in the PR.

### Priority 6 — examples disagree on whether top-level code needs a wrapper *(Slice A)*

A newcomer can't infer whether free fns/types must live in a `commons`/`context` block:
wrapped at `what-is-karn.md:16` and `result-and-optionals.md`; **bare** at `reference/
types.md:26`, `guides/entry-points/http.md:57`, and even `result-and-optionals.md:31` (a bare
`fn` on the *same page* that wraps elsewhere). The glossary hints at a "project vs legacy
mode" distinction (`glossary.md:103`) that likely explains it, but no example signals its
mode, so it reads as randomness.

- **▸ [DECISION] How to resolve the inconsistency.** *Resolve the language fact first, then
  sweep* — this is the one Priority whose fix depends on actual behaviour, so implementation
  begins by confirming the canonical rule (single-file/legacy mode admits bare top-level;
  project mode requires a `commons`/`context` home — per the glossary's distinction and the
  tutorials, where T1 uses `commons` for one file and T2 explains the switch to a project
  directory).
  - **(a, recommended) Standardise every reference/guide snippet to one mode and state the
    assumption once.** Pick the mode each page is really demonstrating, make it consistent,
    and add a single reusable "these snippets assume <mode>" note (the tutorials already
    handle the *transition* well — only the lookup snippets are adrift). Lowest reader
    confusion.
  - **(b) Leave both forms but annotate each snippet's mode inline.** More faithful to "both
    are legal" but noisier on every example.

  Recommend (a). **No language change** — this is a docs-consistency pass; if the snippets
  turn out to demonstrate genuinely-illegal code, that becomes a separate compiler issue, out
  of scope here.

### Smaller items — one sweep *(Slice A, except where noted)*

- **Leftover author note.** `introduction/what-is-karn.md:61` —
  `<!-- Origin note — Matthew, tune this to taste. -->` — remove (the only such comment in
  `docs/src/`).
- **`Effect.pure(())`** — handled under Priority 4 (introduce once + glossary entry).
- **First-party capability index** *(Slice B, optional).* `karn.Secrets`, `karn.Fetch`, `Kv`
  appear mid-recipe (`wrap-a-library.md`) with no catalogue page. **▸ [DECISION]** add a single
  `reference/karn-capabilities.md` index now, or defer. Recommend a *minimal* index now
  (cheap, removes "what built-ins exist?" friction); a fuller treatment can follow.
- **Unframed `(v0.x)` provenance tags** (20+ across reference/guides; some pure trivia, e.g.
  `state-machine.md:50` "Before v0.11 you had to wrap a sum state in `Option[…]`").
  **▸ [DECISION]** (a, recommended) state once, prominently (in `how-these-docs-are-organised.md`
  or the glossary), that `(vN)` means **"introduced in"**, and drop the purely-historical
  asides; (b) drop all inline tags. Recommend (a) — the tags carry real "since" information for
  returning readers; only the narrative-history asides are noise.

## Slicing

| Slice | Contents | Review items | Character |
|---|---|---|---|
| **A — trust fixes** | P1 roadmap, P2 README+intro links, P3 corrupted samples, P6 wrapper consistency, smaller-items sweep (author note, `(vN)` convention) | 1, 2, 3, 6 + smalls | mechanical, minutes to review, ship first |
| **B — on-ramp** | P4 capability-model page, P5 anatomy showpiece + include audit, capability index | 4, 5 | structural, the journey improvement |

Recommended: **two PRs**. Slice A is pure trust-recovery and worth landing on its own the same
day; Slice B is where reviewer attention is better spent. Single-PR is acceptable if preferred.

## Risks

- **Anatomy/showpiece rot (P5).** Mitigated by sourcing it from a compiled worked example via
  `{{#include}}` rather than hand-writing Karn into a markdown fence — the same discipline that
  keeps the diagnostic payoffs honest.
- **Wrapper consistency asserting a falsehood (P6).** Mitigated by resolving the language fact
  before editing; if a snippet is actually illegal, that's flagged as a separate issue, not
  silently "fixed" into a different wrong shape.
- **Reorg corruption beyond the three known samples.** Mitigated by the zero-hit
  `rg 'how-to/|explanation/'` gate, which proves the sweep is complete rather than spot-fixed.
- **Roadmap re-staleness (P1).** Mitigated by decision (a) — naming intent-categories sourced
  from the proposal queues instead of version-pinned milestones that rot on each release.

## Docs delta (the files that move)

*Slice A:* `README.md`; `docs/src/about/versioning-and-roadmap.md`;
`docs/src/spec/appendix-version-history.md`; the introduction landing copy;
`docs/src/troubleshooting/mock-errors.md`; `docs/src/guides/testing/write-tests.md`;
`docs/src/guides/testing/philosophy.md`; `docs/src/introduction/what-is-karn.md`; the
reference/guide snippet pages touched by the P6 pass; one `(vN)`-convention note.

*Slice B:* new `docs/src/guides/effects-and-capabilities/understand-the-capability-model.md`
+ `effects-and-capabilities/index.md` + `SUMMARY.md`; new
`docs/src/introduction/anatomy-of-a-service.md` (+ its compiled example) + `SUMMARY.md`;
`docs/src/reference/glossary.md` (`Effect.pure`); optional new
`docs/src/reference/karn-capabilities.md`.

## Out of scope

- Any grammar/compiler/emitter/LSP change (and therefore any version bump or release tag).
- The v0.44 `from <protocol>` service restructure — that proposal re-touches `entry-points/`
  and `reference/queue.md` independently; this increment's P1/P3/P6 edits don't collide with
  it, and the two can land in either order.
- Restructuring the tutorial spine — the review confirms it is already excellent.

## On merge

Per `design/proposals/README.md`: the implementing PR(s) remove this proposal file (or remove
it once *both* slices land). No decision records — nothing here is a language-defining call;
the design forks above are docs-presentation choices, recorded in this proposal's git history.
The `DOCS-REVIEW.md` report is the input; it can be deleted alongside the proposal once its
findings are addressed.
