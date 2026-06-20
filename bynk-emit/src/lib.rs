//! Bynk's build orchestration and TypeScript emission — the layer above
//! `bynk-check`.
//!
//! `project` is the build driver: it conducts discovery, the dependency graph,
//! consistency, validation, symbols, and paths, and owns `compile_project`.
//! `emitter` lowers a checked program to TypeScript. Read the crate as "build
//! orchestration + TS emission" — orchestration drives emission.
//!
//! Extracted from `bynkc` as slice 4 of the crate-decomposition track over
//! `bynk-syntax` + `bynk-check`. Behaviour is unchanged; `bynkc` depends on this
//! crate and re-exports its modules so its public API (`compile_project`,
//! `ProjectOutput`, …) and the binary are untouched.

pub mod emitter;
pub mod project;
