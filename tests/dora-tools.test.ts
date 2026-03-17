import { test, expect, mock, spyOn } from "bun:test";
import fs from "node:fs";
import childProcess from "node:child_process";

// ── TUS4.1: dora tools (RED) ──────────────────────────────────────────────────
// These tests are written against the expected API of src/tools/dora.ts
// which does not exist yet — they will fail until the GREEN phase.

const EXPECTED_TOOL_NAMES = ["dora_symbol", "dora_refs", "dora_deps", "dora_rdeps", "dora_smells", "dora_cycles"];

test("createDoraTools returns 6 tools with correct names", async () => {
  const { createDoraTools } = await import("../src/tools/dora.ts");
  const tools = createDoraTools("/some/dir");
  expect(tools).toHaveLength(6);
  const names = tools.map((t: any) => t.name);
  for (const expected of EXPECTED_TOOL_NAMES) {
    expect(names).toContain(expected);
  }
});

test("calling a dora tool when .dora/ index is absent returns error message", async () => {
  const existsSpy = spyOn(fs, "existsSync").mockReturnValue(false);
  try {
    const { createDoraTools } = await import("../src/tools/dora.ts");
    const tools = createDoraTools("/some/dir");
    const symbolTool = tools.find((t: any) => t.name === "dora_symbol");
    expect(symbolTool).toBeDefined();
    const result = await symbolTool!.execute("id", { symbol: "Foo" });
    const text = result.content?.[0]?.text ?? "";
    expect(text.toLowerCase()).toContain("index");
  } finally {
    existsSpy.mockRestore();
  }
});

test("dora_deps with mocked execSync returns parsed output", async () => {
  const existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
  const execSyncSpy = spyOn(childProcess, "execSync").mockReturnValue(
    Buffer.from("pkg-a 1.0.0\npkg-b 2.3.1\n")
  );
  try {
    const { createDoraTools } = await import("../src/tools/dora.ts");
    const tools = createDoraTools("/some/dir");
    const depsTool = tools.find((t: any) => t.name === "dora_deps");
    expect(depsTool).toBeDefined();
    const result = await depsTool!.execute("id", { symbol: "MyService" });
    const text = result.content?.[0]?.text ?? "";
    expect(text).toContain("pkg-a");
    expect(text).toContain("pkg-b");
  } finally {
    existsSpy.mockRestore();
    execSyncSpy.mockRestore();
  }
});
