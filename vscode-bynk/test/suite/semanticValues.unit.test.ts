// Unit coverage for the preview parser (src/semanticValues.ts) — the pure renderer
// the interposer applies. The end-to-end debug tests cover the common shapes; this
// pins the *adversarial* cases they can't easily produce: braces/commas/tag-like
// content inside strings (the reason a real parser beats a regex), truncation, and
// the totality guarantee (any non-tagged value comes back byte-for-byte).

import * as assert from "assert";

import { renderBynkValue, relabelBynkLocals } from "../../src/semanticValues";

describe("renderBynkValue (preview parser)", () => {
  const cases: [string, string][] = [
    // Common shapes
    ["{tag: 'Ok', value: 42}", "Ok(42)"],
    ["{tag: 'None'}", "None"],
    ["{tag: 'Some', value: 'hi'}", 'Some("hi")'],
    ["{tag: 'BadRequest', message: 'oops'}", 'BadRequest("oops")'],
    ["{tag: 'Ok', value: {tag: 'Some', value: 42}}", "Ok(Some(42))"],
    ["{tag: 'Created', value: {id: 7, name: 'x'}}", 'Created({id: 7, name: "x"})'],
    ["{tag: 'List', items: [1, 2, 3]}", "List([1, 2, 3])"],
    // Truncation (js-debug elides deep/long previews) is preserved
    ["{tag: 'Ok', value: {…}}", "Ok({…})"],
    ["{tag: 'Big', xs: [1, 2, …]}", "Big([1, 2, …])"],
    // Adversarial: structure characters INSIDE a string must not fool the parser
    ["{tag: 'Weird', message: 'has } brace and , comma'}", 'Weird("has } brace and , comma")'],
    ["{tag: 'X', s: '{tag: fake}'}", 'X("{tag: fake}")'],
    // Totality: non-tagged values returned unchanged
    ["{id: 7, name: 'x'}", "{id: 7, name: 'x'}"],
    ["{value: 42}", "{value: 42}"],
    ["42", "42"],
    ["'plain string'", "'plain string'"],
    ["Timeout", "Timeout"],
    ["undefined", "undefined"],
    ["", ""],
  ];

  for (const [input, expected] of cases) {
    it(`renders ${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      assert.strictEqual(renderBynkValue(input), expected);
    });
  }

  it("never throws on malformed input", () => {
    for (const junk of ["{tag: 'X'", "{{{{", "{tag: }", "{,,,}", "{tag: '\\'}", "{…", "[}"]) {
      assert.doesNotThrow(() => renderBynkValue(junk));
    }
  });
});

describe("relabelBynkLocals (frame structure)", () => {
  it("relabels deps → Capabilities and currentState → State, floated to the top", () => {
    const out = relabelBynkLocals([
      { name: "next", value: "6" },
      { name: "deps", value: "{…}", variablesReference: 11 },
      { name: "currentState", value: "{…}", variablesReference: 12 },
    ]);
    assert.deepStrictEqual(
      out.map((v) => v.name),
      ["Capabilities", "State", "next"],
    );
    // The reference is preserved, so the relabeled group still expands.
    assert.strictEqual(out[0].variablesReference, 11);
    assert.strictEqual(out[1].variablesReference, 12);
  });

  it("leaves frames with no recognised locals untouched (order preserved)", () => {
    const input = [
      { name: "id", value: "7" },
      { name: "body", value: "{…}" },
    ];
    assert.deepStrictEqual(relabelBynkLocals(input).map((v) => v.name), ["id", "body"]);
  });

  it("only relabels exact emitted names (no false positives)", () => {
    // `state` (the DO storage on `this`) is not the agent's `currentState` local.
    const out = relabelBynkLocals([{ name: "state" }, { name: "myDeps" }]);
    assert.deepStrictEqual(out.map((v) => v.name), ["state", "myDeps"]);
  });

  it("is total on odd input", () => {
    assert.deepStrictEqual(relabelBynkLocals([]), []);
    assert.doesNotThrow(() => relabelBynkLocals([{}, { name: 42 as unknown as string }]));
  });
});
