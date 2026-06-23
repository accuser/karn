export interface ValidationError {
  readonly field: string;
  readonly message: string;
  readonly value: unknown;
}

// v0.22b: the JSON-decode error (ADR 0047) — BoundaryError's information
// (the discriminating kind and the tracked field path) flattened into a
// uniform, Bynk-inspectable record. `kind` is "Malformed" for a JSON.parse
// failure, else the BoundaryError kind ("StructuralMismatch",
// "RefinementViolation").
export interface JsonError {
  readonly kind: string;
  readonly path: string;
  readonly message: string;
}
