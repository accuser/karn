# Karn v0.7 Grammar — The Test Declaration Kind

A delta specification introducing the third top-level declaration kind: `test`. After v0.7, Karn supports the full development cycle — write, compose, test — within the language itself. Test declarations target either a commons or a context; they have privileged access relative to their target (construction of opaque types, mocking of providers and consumed contexts), and they're discovered and executed by `karnc test`.

Read all earlier specs first — `karn-mvp-grammar.md` through `karn-mvp-grammar-v0.6.md`. The v0.7 compiler should accept every earlier program unchanged. All v0–v0.6 test fixtures must continue to pass.

**Note on prior implementation state:** "Test as third declaration kind" has been part of the architectural commitment from the design notes onward, but no prior implementation increment has shipped it. v0.7 introduces it for both target kinds (commons and contexts) in one increment. If a partial implementation exists in the v0.6 codebase, reconcile it with this specification.

After v0.7, the language has the development cycle. v0.8+ adds production-deployment refinements (multi-Worker, additional handler kinds, provider composition, sagas, state machines).

---

## 1. Scope

### In scope for v0.7

- **The `test` declaration form** — `test commerce.orders { ... }` and `test commerce.money { ... }`.
- **Targeting commons** — test pure functions and their interactions with shared types.
- **Targeting contexts** — test agents, services, and their behaviour with mocked providers and mocked consumed contexts.
- **Provider mocking** — `mocks Payments = MockPayments { ... }` swaps out a context's provider for the duration of the tests.
- **Consumed-context mocking** — `mocks Payment = MockPayment { ... }` swaps out a consumed context's service surface.
- **Test case blocks** — `test "name" { body }` declaring individual tests.
- **The `assert` statement** — `assert expr` for verifying conditions.
- **The `karnc test` CLI command** — discovers test declarations, runs test cases, reports results.
- **Test runner output** — readable pass/fail summary with failure details.
- **Privileged access** — test bodies can construct exported opaque types, access internal agent state, and inspect private types of the target context.

### Out of scope for v0.7 (deferred to v0.8+)

- **Setup and teardown blocks** (`before`, `after`, `beforeEach`, `afterEach`).
- **Parallel test execution.** v0.7 runs tests sequentially.
- **Property-based testing.**
- **Snapshot testing.**
- **Integration with external test frameworks** (vitest, jest, etc.).
- **Test categorisation, tagging, or filtering** beyond running everything.
- **Code coverage reporting.**
- **Agent state seeding** for tests — agents start with empty state per test.
- **`expect` as an alternative to `assert`** — one assertion mechanism for v0.7.
- **Elaborate assertion forms** beyond `assert expr` (no `assert.matches`, no `assert.throws`, no built-in equality matchers — just Bool expressions).
- **Shared helper functions** declared within a test declaration. Helpers can be free functions in the target's commons or in a separate commons used by the test.
- **Multiple handler kinds beyond `on call`** (still v0.6's constraint).

---

## 2. Updated lexical structure

### New reserved keywords

```
assert    expect    mocks
```

- `assert` — the assertion statement keyword.
- `expect` — reserved but not used in v0.7; reserved for future use (richer assertion forms).
- `mocks` — declares a mock implementation within a test declaration.

The existing `test` keyword (already used in commons tests from earlier conceptual work) is now formally introduced as a top-level declaration introducer.

All other lexical rules are unchanged from v0.6.

---

## 3. Updated grammar

### 3.1 The `test` declaration

```
top-level-decl ::= commons-decl
                 | context-decl
                 | test-decl                              -- NEW v0.7

test-decl ::= doc-block? 'test' QualifiedName '{' test-body '}'
            | doc-block? 'test' QualifiedName test-body-fragment   -- fragment form for multi-file

test-body ::= test-body-item*

test-body-item ::= mock-decl
                 | test-case
                 | uses-decl                              -- tests can use commons too
```

A test declaration targets a commons or context by qualified name. The target must be a declared commons or context in the same project. The body contains mock declarations (for context tests only) and test case blocks.

The fragment form (for multi-file tests) parallels the commons and context fragment forms from v0.3:

```karn
test commerce.orders

mocks Payment = MockPayment { ... }

test "place small order succeeds" { ... }
```

The fragment form is one file per fragment, all sharing the same `test commerce.orders` header. Multi-file tests follow the same conventions as multi-file commons (v0.3) and multi-file contexts (v0.4).

### 3.2 Mock declarations

```
mock-decl ::= doc-block? 'mocks' identifier '=' identifier '{' mock-body '}'

mock-body ::= mock-op+

mock-op ::= 'fn' identifier '(' param-list? ')' '->' type-ref block
```

A mock declaration provides an alternative implementation of either:
- A provider (when the first identifier names a capability in the target context), or
- A consumed context (when the first identifier names a consumed context or its alias).

The compiler resolves which kind based on the name.

**Capability mock form:**

```karn
test commerce.payment {
  mocks Payments = TestPayments {
    fn authorise(amount: Money) -> Effect[Result[AuthId, PaymentError]] {
      if amount.minorUnits < 100000 {
        Effect.pure(Ok(AuthId.unsafe("TEST-AUTH-12345678")))
      } else {
        Effect.pure(Err(Declined))
      }
    }
    
    fn refund(id: AuthId) -> Effect[Result[(), PaymentError]] {
      Effect.pure(Ok(()))
    }
  }
  
  -- test cases follow
}
```

The mock replaces the context's normal provider. The signature must match the capability's operations exactly (same names, same parameters, same return types).

**Consumed-context mock form:**

```karn
test commerce.orders {
  mocks Payment = MockPayment {
    fn authorise(amount: Money) -> Effect[Result[AuthId, PaymentError]] {
      Effect.pure(Ok(AuthId.unsafe("MOCK-AUTH-12345678")))
    }
  }
}
```

Here `Payment` is the alias of a consumed context. The mock provides the surface of services that the consumed context exposes. The mock body has the consumed context's privileges for the duration of its execution (notably: it can construct opaque types from the consumed context, like `AuthId`).

**Mock applies to all test cases within the test declaration.** A given test declaration cannot redefine the same mock partway through. If you need different mocks for different tests, write multiple test declarations.

### 3.3 Test case blocks

```
test-case ::= doc-block? 'test' string-literal block
```

A test case has:
- A name (string literal) used in reporting.
- A body (block) with the test's assertions.

The body has type `Effect[Result[(), AssertionError]]` implicitly. Inside the body:
- `assert expr` statements verify conditions.
- Regular Karn expressions and statements work as in handler bodies.
- The body can use the target's privileged operations (constructing opaque types, accessing internal state).
- Calls to services and agents go through the mocked surface where mocks are declared; through regular implementations otherwise.

Example:

```karn
test commerce.payment {
  mocks Payments = TestPayments {
    fn authorise(amount: Money) -> Effect[Result[AuthId, PaymentError]] {
      Effect.pure(Ok(AuthId.unsafe("AUTH-12345678")))
    }
    fn refund(id: AuthId) -> Effect[Result[(), PaymentError]] {
      Effect.pure(Ok(()))
    }
  }
  
  test "authorise returns an AuthId for a small amount" {
    let result <- authorise.call(Money.fromMinorUnits(100, "USD"))
    assert result.isOk
  }
  
  test "authorise's AuthId has the right format" {
    let result <- authorise.call(Money.fromMinorUnits(100, "USD"))
    match result {
      Ok(authId) => {
        let s = authId.unwrap()
        assert s == "AUTH-12345678"
      }
      Err(_) => {
        assert false
      }
    }
  }
}
```

The service is invoked via `authorise.call(args)` (or just `authorise(args)` if disambiguation isn't needed). Within a test of a context, the context's services are in scope by name.

### 3.4 The `assert` statement

```
statement ::= let-stmt
            | commit-stmt
            | assert-stmt                                  -- NEW v0.7

assert-stmt ::= 'assert' expr
```

The `assert` statement verifies a Bool expression at runtime:

- If the expression evaluates to `true`, the assertion passes; execution continues.
- If `false`, the assertion fails; the enclosing test case fails with an `AssertionError` containing the source location and (where possible) a representation of the failed expression.

`assert` statements can only appear inside test case bodies. Using `assert` elsewhere (in service handlers, agent handlers, capability bodies, free functions) is a compile error.

The expression can be any Bool-typed expression:

```karn
assert result.isOk
assert count == 5
assert items.length > 0
assert price >= Money.zero()
```

The assertion mechanism is purposely simple in v0.7. Future versions may add richer assertion forms (pattern-matching assertions, equality with structured diffs, etc.).

### 3.5 The privileged-access rule

A test declaration targeting `commerce.X` has the same privileges as code declared *within* `commerce.X`:

- Construction of opaque types exported by `commerce.X` is permitted from within the test.
- Internal type details (the representation of opaque types) are visible.
- Private capabilities, services, and agents of `commerce.X` are reachable.
- All providers of `commerce.X` (replaced or not) are reachable.

For tests targeting a context that consumes other contexts, the consuming context's privileges apply normally. The consumed contexts retain their normal encapsulation; the test can interact with them only through their exports (or through mocks).

For mocks targeting a consumed context, the *mock body* has the consumed context's privileges. So `mocks Payment = MockPayment { fn authorise(...) -> ... { Ok(AuthId.unsafe("...")) } }` is allowed because the mock body is "inside" payment for construction purposes.

### 3.6 Updated grammar — summary of additions

```
top-level-decl   ::= ... | test-decl

test-decl        ::= doc-block? 'test' QualifiedName '{' test-body '}'
                   | doc-block? 'test' QualifiedName test-body-fragment

test-body        ::= test-body-item*

test-body-item   ::= mock-decl | test-case | uses-decl

mock-decl        ::= doc-block? 'mocks' identifier '=' identifier '{' mock-op+ '}'

mock-op          ::= 'fn' identifier '(' param-list? ')' '->' type-ref block

test-case        ::= doc-block? 'test' string-literal block

statement        ::= ... | assert-stmt

assert-stmt      ::= 'assert' expr
```

---

## 4. Updated static semantics

### 4.1 Test declaration validation

For `test <qualified-name> { ... }`:

- `<qualified-name>` must resolve to a declared commons or context in the same project.
- The target must be unique — a project can have multiple test declarations targeting the same target, but each test case name within a single target must be unique.
- The fragment form requires all fragments to use the same qualified name.

A test declaration with a target that doesn't exist is a compile error (`karn.test.unknown_target`).

### 4.2 Mock declaration validation

For a mock declaration `mocks X = Impl { ops }`:

1. Resolve `X`:
   - First, check if `X` is a capability of the target context. If yes, this is a provider mock.
   - Otherwise, check if `X` is a consumed-context alias or qualified name. If yes, this is a consumed-context mock.
   - Otherwise, compile error (`karn.mock.unknown_target`).
2. For a provider mock:
   - The mock's operations must match the capability's operations exactly (names, signatures).
   - Missing or extra operations are compile errors.
3. For a consumed-context mock:
   - The mock's operations must match the consumed context's services exactly (each `mocks` operation `fn X.method(...)` corresponds to a service `X` with an `on call` handler in the consumed context).
   - Missing or extra operations are compile errors.
4. Within a single test declaration, the same name cannot be mocked twice. A given test declaration cannot mix provider-mock and consumed-context-mock declarations of the same name.

Tests targeting *commons* cannot have mock declarations — commons have no providers or consumed contexts to mock. The presence of `mocks` in a commons-targeted test is a compile error.

### 4.3 Test case body validation

A test case body type-checks as an `Effect[Result[(), AssertionError]]`-returning block:

- All v0.5 effectful-context rules apply (`<-`, `?`, capability and service calls).
- `assert expr` is valid; `expr` must have type `Bool`.
- Reaching the end of the body without an assertion failure is success.
- An assertion failure causes the body to return early with an `AssertionError`.
- The body must not invoke uncaught panics — all Result-typed operations should be handled.

Within a test body, the target's services and agents are in scope:
- For context targets: `serviceName.call(args)` or `serviceName(args)` invokes a service. `AgentName(key).handlerName(args)` invokes an agent.
- For commons targets: free functions are directly callable; types are constructible (per the privileged-access rule).

### 4.4 Cross-target visibility

A test declaration sees:

- All types and functions in the target's commons (if targeting a commons) or in the target context (if targeting a context).
- All commons that the target context uses (via `uses`).
- All contexts that the target context consumes (via `consumes`), and their exported types.
- Other contexts in the project — but only their *exported* types and *public* services (same as a normal consumer).

A test declaration does *not* see:

- Internal types of other contexts (only the target's internals are visible).
- Test declarations of other targets.

This means a test of `commerce.orders` can use `commerce.payment` (via consumes) but only through its exports — exactly as orders normally would. Tests don't get a free pass into other contexts.

---

## 5. Compilation to TypeScript

### 5.1 Test generation strategy

Each test declaration compiles to a TypeScript module containing:

1. Imports of the target's runtime (commons or context) plus any consumed contexts.
2. Mock implementations as TypeScript classes / objects matching the relevant interfaces.
3. A composition that wires the mocks into the target's deps (replacing the normal providers / surfaces).
4. One async function per test case that runs the body and returns `{ pass: boolean, error?: AssertionError }`.
5. A module-level `run()` function that executes all test cases sequentially and aggregates results.

Generated module file: `out/tests/<qualified-name>.test.ts` (per test declaration).

### 5.2 Generated test runner module

For a context test:

```karn
test commerce.payment {
  mocks Payments = TestPayments {
    fn authorise(amount: Money) -> Effect[Result[AuthId, PaymentError]] {
      Effect.pure(Ok(AuthId.unsafe("AUTH-12345678")))
    }
    fn refund(id: AuthId) -> Effect[Result[(), PaymentError]] {
      Effect.pure(Ok(()))
    }
  }
  
  test "small amounts authorise" {
    let result <- authorise.call(Money.fromMinorUnits(100, "USD"))
    assert result.isOk
  }
}
```

Compiles to (approximately):

```typescript
import * as commerce_payment from "../commerce/payment";
import { Money } from "../commerce/money";

// Mock implementations
class TestPayments implements commerce_payment.Payments {
  async authorise(amount: commerce_payment.Money) {
    return commerce_payment.Result.Ok(
      commerce_payment.AuthId.unsafe("AUTH-12345678")
    );
  }
  async refund(id: commerce_payment.AuthId) {
    return commerce_payment.Result.Ok(undefined);
  }
}

// Test deps (with mock substituted for the normal provider)
const testDeps = {
  Payments: new TestPayments(),
  Logger: new commerce_payment.ConsoleLogger(),
};

// Test cases
async function test_smallAmountsAuthorise() {
  try {
    const result = await commerce_payment.authorise.call(
      Money.fromMinorUnits(100, "USD") as commerce_payment.Money,
      testDeps
    );
    if (!(result.kind === "Ok")) {
      return { pass: false, error: assertionError("result.isOk", "tests/payment.test.karn:14") };
    }
    return { pass: true };
  } catch (e) {
    return { pass: false, error: unexpectedError(e) };
  }
}

// Runner
export async function run() {
  const results = [
    { name: "small amounts authorise", ...(await test_smallAmountsAuthorise()) },
  ];
  return results;
}
```

The generated TypeScript is verbose but mechanical. Users don't write it; the compiler emits it.

### 5.3 The `karnc test` CLI command

`karnc test` (with optional file or directory arguments):

1. Discovers all test declarations in the project's `src` directory (or in the specified files).
2. Compiles them along with the rest of the project (the production code compiles to its normal output; test modules compile to `out/tests/`).
3. Generates a top-level test runner script (`out/tests/main.ts`) that imports each test module's `run()` function and invokes them in sequence.
4. Executes the test runner via Node.js (or a similar JavaScript runtime). For Cloudflare Workers projects, the test runner runs as plain Node.js (no Workers runtime needed — the production code is Workers-compatible TypeScript that can also run in Node).
5. Collects and prints results.

Output format (terminal):

```
Running tests...

commerce.money:
  ✓ formatting renders minor units correctly
  ✓ addition preserves precision

commerce.payment:
  ✓ small amounts authorise
  ✗ large amounts are declined
    assertion failed at src/tests/payment.test.karn:23
    expected: result is Err(Declined)
    actual:   Ok(AUTH-12345678)

commerce.orders:
  ✓ place small order succeeds
  ✓ large order is declined
  ✓ order placement maps payment failures

5 passed, 1 failed.
```

The output is informative — test name, failure details when applicable, summary. Exit code is 0 on all-pass, non-zero on any-fail.

### 5.4 Test isolation

Each test case runs in isolation:

- A fresh deps object is built per test (mocks instantiated anew).
- Agent state starts empty per test (no persistence between tests in v0.7).
- Mocks declared at the test-declaration level apply to all test cases within that declaration.

Tests do not run in parallel in v0.7 — sequential execution avoids state-isolation issues at the runtime level. Parallel execution can come later when the runtime model is more mature.

---

## 6. New test corpus

The v0.7 test corpus adds fixtures for the test declaration kind itself.

### Positive fixtures (new for v0.7)

```
tests/positive/
├── 103_commons_test_basic/                     -- test commerce.money { ... }
├── 104_context_test_with_provider_mock/        -- test commerce.payment with mocks Payments
├── 105_context_test_with_consumed_mock/        -- test commerce.orders with mocks Payment
├── 106_context_test_multiple_cases/            -- multiple test "name" { } blocks
├── 107_test_with_assertion_failure/            -- positive in compilation; assertion fails at runtime
├── 108_test_with_agent/                        -- test exercising agent state
├── 109_test_with_opaque_construction/          -- test constructs an exported opaque type
├── 110_full_orders_payment_tests/              -- worked example: tests for the v0.6 orders↔payment
```

### Negative fixtures (new for v0.7)

```
tests/negative/
├── 84_test_unknown_target/                     -- test commerce.unknown { ... }
├── 85_mock_unknown_target/                     -- mocks Unknown = ... where Unknown is neither
│                                                  a capability nor a consumed context
├── 86_mock_signature_mismatch/                 -- mock with wrong signature for capability
├── 87_mock_in_commons_test/                    -- mocks in test commerce.money (commons doesn't
│                                                  have providers or consumes)
├── 88_assert_outside_test/                     -- assert in a service handler
├── 89_assert_non_bool/                         -- assert someInt
├── 90_duplicate_mock_target/                   -- two mocks <name> = ... in same test decl
├── 91_duplicate_test_name/                     -- two test "X" { ... } in same test decl
```

### v0.7 worked example: tests for orders↔payment integration

Building on v0.6's orders↔payment worked example (fixture 102), v0.7 adds tests for that integration:

**`src/tests/payment.test.karn`** (payment-targeted tests):

```karn
---
Tests for the payment context.
---
test commerce.payment

uses commerce.money

mocks Payments = TestPayments {
  fn authorise(amount: Money) -> Effect[Result[AuthId, PaymentError]] {
    if amount.minorUnits == 0 {
      Effect.pure(Err(Declined))
    } else if amount.minorUnits > 1000000 {
      Effect.pure(Err(InsufficientFunds))
    } else {
      Effect.pure(Ok(AuthId.unsafe("TEST-AUTH-12345678")))
    }
  }
  
  fn refund(id: AuthId) -> Effect[Result[(), PaymentError]] {
    Effect.pure(Ok(()))
  }
}

test "authorise returns Ok for a small positive amount" {
  let result <- authorise.call(Money.fromMinorUnits(100, "USD"))
  assert result.isOk
}

test "authorise returns Err(Declined) for zero" {
  let result <- authorise.call(Money.fromMinorUnits(0, "USD"))
  match result {
    Err(Declined) => assert true
    _             => assert false
  }
}

test "authorise returns Err(InsufficientFunds) for large amounts" {
  let result <- authorise.call(Money.fromMinorUnits(2000000, "USD"))
  match result {
    Err(InsufficientFunds) => assert true
    _                      => assert false
  }
}
```

**`src/tests/orders.test.karn`** (orders-targeted tests, mocking the consumed payment context):

```karn
---
Tests for the orders context. Mocks the consumed payment context.
---
test commerce.orders

uses commerce.money

mocks Payment = MockPayment {
  fn authorise(amount: Money) -> Effect[Result[AuthId, PaymentError]] {
    if amount.minorUnits > 50000 {
      Effect.pure(Err(Declined))
    } else {
      Effect.pure(Ok(AuthId.unsafe("MOCK-AUTH-12345678")))
    }
  }
}

test "small order places successfully" {
  let order = OrderEntity(OrderId.unsafe("ORD-001"))
  let result <- order.place(Money.fromMinorUnits(5000, "USD"))
  assert result.isOk
}

test "large order is declined" {
  let order = OrderEntity(OrderId.unsafe("ORD-002"))
  let result <- order.place(Money.fromMinorUnits(100000, "USD"))
  match result {
    Err(PaymentDeclined) => assert true
    _                    => assert false
  }
}

test "order state reflects placement" {
  let order = OrderEntity(OrderId.unsafe("ORD-003"))
  let _ <- order.place(Money.fromMinorUnits(1000, "USD"))
  
  -- order state should now show placed = true and an authId
  -- Direct state inspection requires an agent accessor — for v0.7,
  -- exercise this via a status() service if defined, otherwise via
  -- consequences of the place call
  assert true
}
```

These tests exercise:
- A commons-style test (commerce.money) — pure-function verification.
- A context test with provider mocking — payment with a mocked Payments capability.
- A context test with consumed-context mocking — orders with a mocked Payment surface.
- The Anti-Corruption Layer pattern through the test — orders' OrderError variants reflect the payment errors via the orders → payment call path.

The test runner output:

```
Running tests...

commerce.payment:
  ✓ authorise returns Ok for a small positive amount
  ✓ authorise returns Err(Declined) for zero
  ✓ authorise returns Err(InsufficientFunds) for large amounts

commerce.orders:
  ✓ small order places successfully
  ✓ large order is declined
  ✓ order state reflects placement

6 passed, 0 failed.
```

---

## 7. Implementation notes

### 7.1 Backwards compatibility

All v0–v0.6 fixtures must pass. The grammar additions are additive — three new keywords (`assert`, `expect`, `mocks`) plus the existing `test` keyword formalised as a top-level introducer.

If the v0.6 codebase has any partial commons-test infrastructure (from prior conceptual work that wasn't formally specified), it should be reconciled with v0.7's spec. The reconciliation strategy: v0.7 is the source of truth; replace partial implementations with the full v0.7 behaviour.

### 7.2 Where new code goes

- `lexer.rs`: new keywords (`assert`, `expect`, `mocks`); formalise `test` if not already reserved.
- `ast.rs`:
  - `TestDecl` AST node with target qualified name, mocks list, test cases list.
  - `MockDecl` AST node with target name, implementation name, operations.
  - `TestCase` AST node with name, body.
  - `Statement::Assert(Box<Expr>)`.
- `parser.rs`:
  - Parsing the test declaration form (brace and fragment).
  - Parsing mock declarations.
  - Parsing test case blocks.
  - Parsing the assert statement.
- `project.rs`:
  - Registration of test declarations.
  - Resolution of test targets to commons or contexts.
  - Detecting duplicate test case names within a target.
- `resolver.rs`:
  - Resolving mock targets (capability vs consumed context).
  - Validating mock signatures against capability/service signatures.
  - Setting up the test body's symbol table with the target's privileges.
- `checker.rs`:
  - Type-checking mock operation bodies (with the mocked entity's privileges).
  - Type-checking test case bodies (as Effect[Result[(), AssertionError]]).
  - Validating that `assert` only appears in test bodies.
  - Validating that mocks only appear in context-targeted tests, not commons-targeted ones.
- `emitter.rs`:
  - Generating test-module TypeScript per test declaration.
  - Mock classes implementing capability or context-surface interfaces.
  - Test case functions with the runner shape.
  - Per-target test runner module.
  - Top-level test runner (`out/tests/main.ts`) that aggregates all.
- `karnc/src/cli.rs` (or similar): `karnc test` subcommand.
  - Discovers test declarations.
  - Triggers compilation with test modules included.
  - Invokes Node.js to run the generated test runner.
  - Captures output, prints results.

### 7.3 Risk areas

- **Mock target resolution.** The `mocks X = Impl { ... }` form needs to disambiguate "X is a capability" vs "X is a consumed context alias." Both come up in real tests. The resolver checks both name spaces; if X matches in only one, that's the kind of mock. If X matches in both (rare, but possible), it's an ambiguity error.

- **Privileged access in mock bodies.** Inside a `mocks Payment = ...` block (where Payment is a consumed-context mock), the mock body is "inside" payment for construction purposes. This means the mock body's type checker treats payment's opaque types as constructible. Implementation: when type-checking a consumed-context mock body, switch the symbol-table context to the consumed context's privileged view.

- **Test runner invocation.** `karnc test` needs to invoke Node.js on the generated test runner. This requires Node.js to be installed; document this as a requirement. For Cloudflare Workers projects specifically, consider whether to use `wrangler dev` or `miniflare` for tests that need the Workers runtime — but for v0.7, plain Node.js is sufficient.

- **Failure reporting.** When an `assert` fails, the report should be informative. At minimum: which test failed, which assertion (by source location), and the expression that was asserted. Richer reporting (showing intermediate values, structured diffs for equality assertions) can come in v0.8+.

- **Cross-version test discovery.** A v0.7 test of a v0.5 context should work — tests don't change the target's semantics, just exercise them. Make sure the test infrastructure doesn't accidentally require features from v0.6 in the target context.

### 7.4 What "done" looks like

1. All v0–v0.6 fixtures pass (regression).
2. All v0.7 fixtures pass (8 positive, 8 negative).
3. `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check` clean.
4. `karnc test` discovers and runs tests in the worked example projects.
5. Test runner output is readable, with clear pass/fail summary and failure details.
6. The v0.7 worked examples (payment tests, orders tests) compile and all pass on `karnc test`.
7. Tests with deliberate failures produce informative error messages.

---

## 8. v0.8 preview

What's coming after v0.7:

**Production-deployment refinements** — the suite of features that take Karn from "feature-complete for application code" to "production-ready for serious deployment."

- **Multi-Worker deployment.** Cross-context calls via fetch() / Service Bindings, with runtime serialisation. The wire format becomes real; structural projection becomes a runtime operation.
- **Additional handler kinds.** `on http POST /path { ... }` for HTTP routes, `on queue("orders") { ... }` for queue consumers, `on cron("0 * * * *") { ... }` for scheduled tasks.
- **Provider composition.** Wrapper providers (decorators) — `provides Logger = LoggerWithCorrelationId wraps ConsoleLogger { ... }` — for adding cross-cutting concerns.
- **Cross-context capability resolution.** A context exposing capabilities for other contexts to use. Architectural commitment to be specified carefully.
- **State machines as sum types.** Agent state declared as a sum type (e.g., `state = Pending | Placed | Cancelled`), with state-specific handlers and transitions.
- **Saga and compensation machinery.** Coordinated multi-context operations with rollback semantics.
- **Refinement narrowing checks.** Tighten the v0.6 conservative "exact match" rule to proper subset checking.
- **Test refinements:** parallel execution, parametric tests, snapshot testing.
- **Standard library expansion** — string manipulation, collections, time utilities, more.

After v0.8, Karn is broadly complete. The language is feature-complete; tooling is mature; the apprentice-facing curriculum can be built on a stable foundation.
