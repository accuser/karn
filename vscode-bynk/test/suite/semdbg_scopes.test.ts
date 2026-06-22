// Semantic-debugging slice 2: the handler frame reads in Bynk structure (Node).
//
// Exercises the production interposer (src/debug.ts → relabelBynkLocals): a
// `__bynkChild` attach with no generator, so the extension's tracker rewrites the
// Local-scope `variables` response — relabelling `deps` → `Capabilities` and an
// agent's `currentState` → `State`, floated to the top, the groups still expandable,
// user bindings intact. No compiler needed (the locals mirror the emitter's shapes).

import * as assert from "assert";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { spawn, spawnSync, ChildProcess } from "child_process";
import * as vscode from "vscode";

function nodeStripsTypes(): boolean {
  try {
    const v = spawnSync("node", ["--version"], { encoding: "utf8" }).stdout.trim();
    const m = v.match(/^v(\d+)\.(\d+)/);
    if (!m) return false;
    const [maj, min] = [Number(m[1]), Number(m[2])];
    return maj > 22 || (maj === 22 && min >= 6);
  } catch {
    return false;
  }
}

describe("Semantic debugging — frame structure (Node)", () => {
  let dir: string;
  let child: ChildProcess | undefined;

  before(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bynk-scopes-")));
    // Locals mirror an emitted agent handler: `deps` (capabilities), `currentState`
    // (loaded state), a user binding `next`. Objects so they carry a reference.
    const entry = [
      "function tick() {",
      '  const deps = { Logger: { name: "log" }, Kv: { name: "kv" } };',
      '  const currentState = { count: 5 };',
      "  const __r0 = { spilled: true };", // a compiler temp (slice 4 suppresses it)
      "  const next = 6;",
      "  return [deps, currentState, __r0, next];", // breakpoint (line 6)
      "}",
      "setInterval(tick, 100);",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(dir, "entry.ts"), entry);
  });

  after(() => {
    child?.kill();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it("relabels deps/currentState into Capabilities/State groups via the production tracker", async function () {
    if (!nodeStripsTypes()) this.skip();
    this.timeout(40_000);
    const verbose = process.env.BYNK_DEBUG_SPIKE === "verbose";

    child = spawn(
      "node",
      ["--experimental-strip-types", "--inspect-brk=0", path.join(dir, "entry.ts")],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    const port = await new Promise<number>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("node never printed an inspector URL")), 8000);
      child!.stderr?.on("data", (b) => {
        const m = String(b).match(/ws:\/\/127\.0\.0\.1:(\d+)\//);
        if (m) {
          clearTimeout(t);
          resolve(Number(m[1]));
        }
      });
    });

    const bpLine = 6;
    let vars: any[] | undefined;
    const reader = vscode.debug.registerDebugAdapterTrackerFactory("*", {
      createDebugAdapterTracker(s: vscode.DebugSession) {
        return {
          async onDidSendMessage(m: any) {
            if (m.type !== "event" || m.event !== "stopped") return;
            const threadId = m.body?.threadId ?? 0;
            let frame: any;
            try {
              const st: any = await s.customRequest("stackTrace", { threadId, levels: 1 });
              frame = st?.stackFrames?.[0];
            } catch {
              /* ignore */
            }
            if (!frame || frame.line !== bpLine) {
              void s.customRequest("continue", { threadId });
              return;
            }
            try {
              const sc: any = await s.customRequest("scopes", { frameId: frame.id });
              const local =
                sc.scopes.find((x: any) => x.presentationHint === "locals") ?? sc.scopes[0];
              const r: any = await s.customRequest("variables", {
                variablesReference: local.variablesReference,
              });
              vars = r.variables;
              if (verbose) console.log("[vars]", JSON.stringify(vars?.map((v) => v.name)));
            } catch (e) {
              if (verbose) console.log("[err]", String(e));
            }
          },
        };
      },
    });

    const bp = new vscode.SourceBreakpoint(
      new vscode.Location(
        vscode.Uri.file(path.join(dir, "entry.ts")),
        new vscode.Position(bpLine - 1, 0),
      ),
    );
    vscode.debug.addBreakpoints([bp]);

    const ok = await vscode.debug.startDebugging(undefined, {
      type: "node",
      request: "attach",
      name: "bynk-scopes",
      port,
      resolveSourceMapLocations: null,
      skipFiles: ["<node_internals>/**"],
      __bynkChild: "scopes-test",
    } as vscode.DebugConfiguration);
    assert.ok(ok, "startDebugging returned true");

    try {
      const deadline = Date.now() + 25_000;
      while (Date.now() < deadline && vars === undefined) {
        await new Promise((r) => setTimeout(r, 200));
      }
      assert.ok(vars, "read the Local scope variables");
      const names = vars!.map((v) => v.name);
      // Bynk groups float to the top, in order; the emitted names are gone.
      assert.strictEqual(names[0], "Capabilities", `Capabilities first, got ${names}`);
      assert.strictEqual(names[1], "State", `State second, got ${names}`);
      assert.ok(names.includes("next"), "user binding preserved");
      assert.ok(!names.includes("deps") && !names.includes("currentState"), "emitted names relabeled");
      // Slice 4: the compiler temporary is suppressed.
      assert.ok(!names.includes("__r0"), `__-temp suppressed, got ${names}`);
      // The relabeled group still expands (reference preserved).
      const caps = vars!.find((v) => v.name === "Capabilities");
      assert.ok(caps.variablesReference > 0, "Capabilities is still expandable");
    } finally {
      reader.dispose();
      vscode.debug.removeBreakpoints([bp]);
      await vscode.debug.stopDebugging();
    }
  });
});
