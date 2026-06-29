# 0139 — The wasm toolchain: an in-memory compile seam + `bynk-wasm` (`bynk_compile`)

- **Status:** Accepted (in-browser track, slice 3; v0.108.3).
- **Provenance:** the fourth slice of the in-browser track. Slices 0–2 made the
  emitter strip-only (ADR 0136), added a JS artefact (ADR 0137), and a Browser
  platform binding (ADR 0138). This slice compiles the `syntax → check → emit`
  pipeline to `wasm32` so the browser can *compile* Bynk — the last piece before the
  REPL shell. Settles the track's Q3 (wasm payload) in favour of shipping the full
  checker.
- **Relation to prior records:** composes the in-memory pipeline with the JS strip
  ([ADR 0137](0137-first-class-js-artefact.md), now in `bynk-strip`) and the Browser
  binding ([ADR 0138](0138-browser-platform.md)); reuses the slice-2 platform lock
  for subset enforcement. TypeScript-first output is untouched.

## Context

The REPL needs the compiler *in the browser*, not the program-as-wasm (WASM as
program output stays rejected — design notes §19). The `bynk-syntax → bynk-check →
bynk-emit` crates are largely portable, but `bynk-emit`'s project driver discovers
and reads sources from the filesystem, which a browser has not got. A wasm entry
needs to compile a single **in-memory** source — the in-process `Bundle` subset that
`consumes bynk` — with no disk and no `tsc`.

## Decision

**Carve an fs-free in-memory compile seam into the existing pipeline and expose it
through a dedicated `bynk-wasm` crate.**

- **D1 — `bynk_emit::project::compile_in_memory(source, target, platform)`.** It runs
  the *whole* project pipeline over one in-memory source, so first-party injection
  (the `bynk` surface) and the per-platform binding emission happen exactly as
  on-disk — the result is the complete module graph (the user unit + `runtime.ts` +
  the `bynk-<platform>.ts` binding + `compose.ts`). The seam is small: `run_checks`
  gained an optional pre-discovered file list (skipping `phase_discovery` when
  supplied), and the source rides in the existing `overlay` map, so no disk read
  fires. The module's logical path is **derived from its declared unit name**
  (`app.demo` ⇒ `app/demo.bynk`) so the name↔path alignment check passes without real
  files.

- **D2 — `bynk-wasm`, a `publish = false` crate with one entry.** `bynk_compile(source)
  → JSON { files: [{path, contents}], diagnostics: [{path, line, col, severity,
  category, message}] }` composes `compile_in_memory` (Bundle/Browser) with
  `strip_project_to_js`. It returns the **full stripped module graph** (the REPL links
  and caches it as it likes), not just the user module. `publish = false` because it is
  a build artefact, not a library — so it needs no crates.io/seed-first publish, and
  its wasm-bindgen/wasm deps stay out of every native crate. `strip_project_to_js`
  moved from `bynkc` into `bynk-strip` so the CLI and the wasm entry share one
  implementation (no cycle — `bynk-emit` does not depend on `bynk-strip`).

- **D3 — Ship `bynk-check` (Q3).** Diagnostics are the point of a REPL, and emit is not
  separable from check (emit needs the typed program). The entire pipeline — including
  oxc (the strip engine) and ariadne — compiles to `wasm32-unknown-unknown` cleanly,
  with no feature-gating. Payload squeezing (`wasm-opt`, thin-LTO, lazy-load) is a
  measured optimisation for the REPL slice, not a precondition.

- **D4 — Verify by native tests + a wasm32 build-gate.** The compile path is exercised
  by native tests (it is plain Rust); a CI leg builds `bynk-wasm` for
  `wasm32-unknown-unknown` to prove browser-target compatibility. Executing the wasm in
  a browser/node harness lands with the REPL shell (slice 4). Subset enforcement is
  free: a program reaching Cloudflare/Workers-only shapes is rejected through the
  slice-2 platform lock (`bynk.target.vendor_required`) on the in-memory path too.

## Consequences

- The playground can compile *and* (with the Browser binding) run the in-process
  subset of Bynk in the browser, with no `tsc`/Node in the loop.
- `compile_in_memory` is also the seam a future "compile a virtual multi-file project"
  mode reuses — the file-list + overlay injection generalises beyond one source.
- `bynk-wasm` carries oxc + the full pipeline; the wasm payload is real and unmeasured
  here — the REPL slice owns the size budget (D3's named optimisations) and the
  in-browser execution proof.
- The next slice is the REPL shell: the editor, the sandboxed iframe+Worker execution
  model, diagnostics surfacing, and decoding a shared snippet from the URL hash.
