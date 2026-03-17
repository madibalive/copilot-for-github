import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import fs from "node:fs";
import childProcess from "node:child_process";
import path from "node:path";

const DORA_INDEX_DIR = ".dora";

function indexExists(workingDir: string): boolean {
  return fs.existsSync(path.join(workingDir, DORA_INDEX_DIR));
}

function noIndexError(): { content: [{ type: "text"; text: string }] } {
  return {
    content: [{ type: "text", text: "Error: dora index not found. Run `dora index` first to build the SCIP index in .dora/." }],
  };
}

function run(workingDir: string, args: string[]): string {
  return childProcess.execSync(["dora", ...args].join(" "), { cwd: workingDir }).toString("utf8").trim();
}

const SymbolSchema = Type.Object({ symbol: Type.String({ description: "Fully-qualified symbol name or pattern" }) });
const RefsSchema = Type.Object({ symbol: Type.String({ description: "Symbol to find references for" }) });
const DepsSchema = Type.Object({ symbol: Type.String({ description: "Symbol to list dependencies of" }) });
const RDepsSchema = Type.Object({ symbol: Type.String({ description: "Symbol to list reverse-dependencies of" }) });
const SmellsSchema = Type.Object({ path: Type.Optional(Type.String({ description: "File or directory path to check (defaults to whole repo)" })) });
const CyclesSchema = Type.Object({ path: Type.Optional(Type.String({ description: "Scope path for cycle detection" })) });

export function createDoraTools(workingDir: string): AgentTool<any>[] {
  const symbolTool: AgentTool<typeof SymbolSchema> = {
    name: "dora_symbol",
    label: "Dora symbol lookup",
    description: "Look up a symbol by name in the SCIP code index.",
    parameters: SymbolSchema,
    execute: async (_id, params) => {
      if (!indexExists(workingDir)) return noIndexError();
      const output = run(workingDir, ["symbol", params.symbol]);
      return { content: [{ type: "text", text: output }] };
    },
  };

  const refsTool: AgentTool<typeof RefsSchema> = {
    name: "dora_refs",
    label: "Dora references",
    description: "Find all references to a symbol.",
    parameters: RefsSchema,
    execute: async (_id, params) => {
      if (!indexExists(workingDir)) return noIndexError();
      const output = run(workingDir, ["refs", params.symbol]);
      return { content: [{ type: "text", text: output }] };
    },
  };

  const depsTool: AgentTool<typeof DepsSchema> = {
    name: "dora_deps",
    label: "Dora dependencies",
    description: "List direct dependencies of a symbol.",
    parameters: DepsSchema,
    execute: async (_id, params) => {
      if (!indexExists(workingDir)) return noIndexError();
      const output = run(workingDir, ["deps", params.symbol]);
      return { content: [{ type: "text", text: output }] };
    },
  };

  const rdepsTool: AgentTool<typeof RDepsSchema> = {
    name: "dora_rdeps",
    label: "Dora reverse-dependencies",
    description: "List symbols that depend on the given symbol.",
    parameters: RDepsSchema,
    execute: async (_id, params) => {
      if (!indexExists(workingDir)) return noIndexError();
      const output = run(workingDir, ["rdeps", params.symbol]);
      return { content: [{ type: "text", text: output }] };
    },
  };

  const smellsTool: AgentTool<typeof SmellsSchema> = {
    name: "dora_smells",
    label: "Dora code smells",
    description: "Detect code smells (large classes, long methods, etc.) via SCIP index.",
    parameters: SmellsSchema,
    execute: async (_id, params) => {
      if (!indexExists(workingDir)) return noIndexError();
      const args = params.path ? ["smells", params.path] : ["smells"];
      const output = run(workingDir, args);
      return { content: [{ type: "text", text: output }] };
    },
  };

  const cyclesTool: AgentTool<typeof CyclesSchema> = {
    name: "dora_cycles",
    label: "Dora dependency cycles",
    description: "Detect circular dependencies in the codebase.",
    parameters: CyclesSchema,
    execute: async (_id, params) => {
      if (!indexExists(workingDir)) return noIndexError();
      const args = params.path ? ["cycles", params.path] : ["cycles"];
      const output = run(workingDir, args);
      return { content: [{ type: "text", text: output }] };
    },
  };

  return [symbolTool, refsTool, depsTool, rdepsTool, smellsTool, cyclesTool];
}
