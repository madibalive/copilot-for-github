import { test, expect, afterEach } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createReadOnlyTools } from "../src/tools/fs.ts";
import { createReviewTools } from "../src/tools/review.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDir = path.join(process.cwd(), "data");
const tempPath = path.join(tempDir, "tmp-hashline-test.txt");

function computeHash(content: string): string {
  return createHash("md5").update(content).digest("hex").slice(0, 4);
}

const HASHLINE_RE = /^\d+:[0-9a-f]{4}\|/;

afterEach(async () => {
  try {
    await fs.unlink(tempPath);
  } catch {
    // ignore
  }
});

function makeOctokitSpy() {
  const calls: Array<{ type: string; args: any }> = [];
  const octokit = {
    rest: {
      pulls: {
        createReviewComment: async (args: any) => {
          calls.push({ type: "comment", args });
          return { data: { id: 42 } };
        },
        createReplyForReviewComment: async (args: any) => {
          calls.push({ type: "reply", args });
          return { data: { id: 43 } };
        },
        updateReviewComment: async (args: any) => {
          calls.push({ type: "update", args });
          return { data: { id: args.comment_id } };
        },
      },
      issues: {
        createComment: async (args: any) => {
          calls.push({ type: "issue_comment", args });
          return { data: { id: 44 } };
        },
        updateComment: async (args: any) => {
          calls.push({ type: "issue_update", args });
          return { data: { id: args.comment_id } };
        },
      },
    },
    graphql: async (query: string, args: any) => {
      calls.push({ type: "graphql", args });
      return { resolveReviewThread: { thread: { id: args.threadId, isResolved: true } } };
    },
  };
  return { octokit, calls };
}

// Patch covering RIGHT side lines 1-3 (context line1, changed line2, context line3)
// This lets tests suggest on line 2 RIGHT.
const SUGGEST_PATCH = `@@ -1,3 +1,3 @@\n function hello() {\n-  return 42;\n+  return 42;\n }\n`;
const SUGGEST_FILE = path.posix.join("data", "tmp-hashline-test.txt");

function makeReviewTools(opts: { repoRoot?: string; hashlinesEnabled?: boolean } = {}) {
  const { octokit, calls } = makeOctokitSpy();
  const tools = createReviewTools({
    octokit: octokit as any,
    owner: "o",
    repo: "r",
    pullNumber: 1,
    headSha: "sha",
    modelId: "model",
    reviewSha: "sha",
    changedFiles: [{ filename: SUGGEST_FILE, status: "modified", additions: 1, deletions: 1, changes: 2, patch: SUGGEST_PATCH }],
    getBilling: () => ({ input: 0, output: 0, total: 0, cost: 0 }),
    existingComments: [],
    reviewThreads: [],
    repoRoot: opts.repoRoot,
    hashlinesEnabled: opts.hashlinesEnabled,
  });
  return { tools, calls };
}

// ---------------------------------------------------------------------------
// Read tool — hashline annotations
// ---------------------------------------------------------------------------

test("read tool emits hashline format when hashlines enabled", async () => {
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(tempPath, "alpha\nbeta\ngamma\n", "utf8");

  const tools = createReadOnlyTools(process.cwd(), { hashlines: true });
  const readTool = tools.find((t) => t.name === "read")!;

  const result = await readTool.execute("", { path: path.posix.join("data", "tmp-hashline-test.txt") });
  const lines = result.content[0].text.split("\n");

  // Every non-empty line should match the hashline format
  const contentLines = lines.filter((l) => l.trim());
  expect(contentLines.length).toBeGreaterThan(0);
  for (const line of contentLines) {
    expect(line).toMatch(HASHLINE_RE);
  }
});

test("read tool prefixes correct line numbers", async () => {
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(tempPath, "alpha\nbeta\ngamma\n", "utf8");

  const tools = createReadOnlyTools(process.cwd(), { hashlines: true });
  const readTool = tools.find((t) => t.name === "read")!;

  const result = await readTool.execute("", { path: path.posix.join("data", "tmp-hashline-test.txt") });
  const text = result.content[0].text;

  // Non-empty lines should start with 1:, 2:, 3:
  const lines = text.split("\n").filter((l) => l.trim());
  expect(lines[0]).toMatch(/^1:/);
  expect(lines[1]).toMatch(/^2:/);
  expect(lines[2]).toMatch(/^3:/);
});

test("read tool partial range uses requested start_line as base", async () => {
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(tempPath, "a\nb\nc\nd\ne\n", "utf8");

  const tools = createReadOnlyTools(process.cwd(), { hashlines: true });
  const readTool = tools.find((t) => t.name === "read")!;

  const result = await readTool.execute("", {
    path: path.posix.join("data", "tmp-hashline-test.txt"),
    start_line: 3,
    end_line: 5,
  });
  const text = result.content[0].text;
  const contentLines = text.split("\n").filter((l) => l.trim() && !l.startsWith("[read"));

  // Should prefix with 3:, 4:, 5: — NOT 1:, 2:, 3:
  expect(contentLines[0]).toMatch(/^3:/);
  expect(contentLines[1]).toMatch(/^4:/);
  expect(contentLines[2]).toMatch(/^5:/);
});

test("read tool hash is 4 lowercase hex chars", async () => {
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(tempPath, "hello world\n", "utf8");

  const tools = createReadOnlyTools(process.cwd(), { hashlines: true });
  const readTool = tools.find((t) => t.name === "read")!;

  const result = await readTool.execute("", { path: path.posix.join("data", "tmp-hashline-test.txt") });
  const line = result.content[0].text.split("\n").find((l) => l.includes("hello world"))!;

  // Format: lineNum:4hexchars|content
  const match = line.match(/^\d+:([0-9a-f]{4})\|/);
  expect(match).not.toBeNull();
  expect(match![1]).toHaveLength(4);
  expect(match![1]).toMatch(/^[0-9a-f]{4}$/);
});

test("read tool hash matches node:crypto md5 computation", async () => {
  await fs.mkdir(tempDir, { recursive: true });
  const lineContent = "function hello() {";
  await fs.writeFile(tempPath, `${lineContent}\n`, "utf8");

  const tools = createReadOnlyTools(process.cwd(), { hashlines: true });
  const readTool = tools.find((t) => t.name === "read")!;

  const result = await readTool.execute("", { path: path.posix.join("data", "tmp-hashline-test.txt") });
  const outputLine = result.content[0].text.split("\n").find((l) => l.includes("function hello"))!;

  const expectedHash = computeHash(lineContent);
  expect(outputLine).toBe(`1:${expectedHash}|${lineContent}`);
});

test("read tool hash is deterministic across two calls", async () => {
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(tempPath, "stable content\n", "utf8");

  const tools = createReadOnlyTools(process.cwd(), { hashlines: true });
  const readTool = tools.find((t) => t.name === "read")!;
  const params = { path: path.posix.join("data", "tmp-hashline-test.txt") };

  const r1 = await readTool.execute("", params);
  const r2 = await readTool.execute("", params);

  expect(r1.content[0].text).toBe(r2.content[0].text);
});

test("read tool does not annotate when hashlines not set (default off)", async () => {
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(tempPath, "plain content\n", "utf8");

  const tools = createReadOnlyTools(process.cwd());
  const readTool = tools.find((t) => t.name === "read")!;

  const result = await readTool.execute("", { path: path.posix.join("data", "tmp-hashline-test.txt") });
  const text = result.content[0].text;

  expect(text).not.toMatch(HASHLINE_RE);
  expect(text).toContain("plain content");
});

// ---------------------------------------------------------------------------
// Suggest tool — hash verification
// ---------------------------------------------------------------------------

test("suggest tool posts when content_hash matches", async () => {
  await fs.mkdir(tempDir, { recursive: true });
  const line1 = "function hello() {";
  const line2 = "  return 42;";
  const line3 = "}";
  await fs.writeFile(tempPath, `${line1}\n${line2}\n${line3}\n`, "utf8");

  const { tools, calls } = makeReviewTools({ repoRoot: process.cwd(), hashlinesEnabled: true });
  const suggestTool = tools.find((t) => t.name === "suggest")!;

  const hash = computeHash(line2);
  const result = await suggestTool.execute("", {
    path: path.posix.join("data", "tmp-hashline-test.txt"),
    line: 2,
    side: "RIGHT",
    suggestion: "  return 43;",
    content_hash: hash,
  });

  expect(result.details.id).not.toBe(-1);
  expect(calls.some((c) => c.type === "comment")).toBe(true);
});

test("suggest tool rejects when content_hash does not match", async () => {
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(tempPath, "function hello() {\n  return 42;\n}\n", "utf8");

  const { tools, calls } = makeReviewTools({ repoRoot: process.cwd(), hashlinesEnabled: true });
  const suggestTool = tools.find((t) => t.name === "suggest")!;

  const result = await suggestTool.execute("", {
    path: path.posix.join("data", "tmp-hashline-test.txt"),
    line: 2,
    side: "RIGHT",
    suggestion: "  return 43;",
    content_hash: "dead", // wrong hash
  });

  expect(result.details.id).toBe(-1);
  expect(result.content[0].text).toContain("Hash mismatch");
  expect(result.content[0].text).toContain("dead");
  // No GitHub API calls
  expect(calls.length).toBe(0);
});

test("suggest tool posts without verification when no content_hash", async () => {
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(tempPath, "function hello() {\n  return 42;\n}\n", "utf8");

  const { tools, calls } = makeReviewTools({ repoRoot: process.cwd(), hashlinesEnabled: true });
  const suggestTool = tools.find((t) => t.name === "suggest")!;

  await suggestTool.execute("", {
    path: path.posix.join("data", "tmp-hashline-test.txt"),
    line: 2,
    side: "RIGHT",
    suggestion: "  return 43;",
    // no content_hash
  });

  expect(calls.some((c) => c.type === "comment")).toBe(true);
});

test("suggest tool skips verification when hashlinesEnabled is false", async () => {
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(tempPath, "function hello() {\n  return 42;\n}\n", "utf8");

  const { tools, calls } = makeReviewTools({ repoRoot: process.cwd(), hashlinesEnabled: false });
  const suggestTool = tools.find((t) => t.name === "suggest")!;

  // Wrong hash — but verification is disabled so it should still post
  await suggestTool.execute("", {
    path: path.posix.join("data", "tmp-hashline-test.txt"),
    line: 2,
    side: "RIGHT",
    suggestion: "  return 43;",
    content_hash: "dead",
  });

  expect(calls.some((c) => c.type === "comment")).toBe(true);
});

test("suggest rejection message includes file path and line number", async () => {
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(tempPath, "line one\nline two\n", "utf8");

  const { tools } = makeReviewTools({ repoRoot: process.cwd(), hashlinesEnabled: true });
  const suggestTool = tools.find((t) => t.name === "suggest")!;

  const result = await suggestTool.execute("", {
    path: path.posix.join("data", "tmp-hashline-test.txt"),
    line: 1,
    side: "RIGHT",
    suggestion: "changed",
    content_hash: "0000",
  });

  expect(result.content[0].text).toContain("tmp-hashline-test.txt");
  expect(result.content[0].text).toContain(":1");
});

// ---------------------------------------------------------------------------
// Round-trip: read with hashlines, use hash in suggest
// ---------------------------------------------------------------------------

test("hash from hashline read can be passed directly to suggest for round-trip verification", async () => {
  await fs.mkdir(tempDir, { recursive: true });
  const lines = ["import foo from 'foo';", "const x = foo();", "export default x;"];
  await fs.writeFile(tempPath, lines.join("\n") + "\n", "utf8");

  // 1. Read with hashlines enabled
  const readTools = createReadOnlyTools(process.cwd(), { hashlines: true });
  const readTool = readTools.find((t) => t.name === "read")!;
  const readResult = await readTool.execute("", { path: path.posix.join("data", "tmp-hashline-test.txt") });

  // 2. Parse out hash for line 2
  const outputLines = readResult.content[0].text.split("\n");
  const line2Output = outputLines.find((l) => l.startsWith("2:"))!;
  const hashFromRead = line2Output.match(/^2:([0-9a-f]{4})\|/)![1];

  // 3. Use that hash in suggest — should pass verification
  const { tools, calls } = makeReviewTools({ repoRoot: process.cwd(), hashlinesEnabled: true });
  const suggestTool = tools.find((t) => t.name === "suggest")!;
  await suggestTool.execute("", {
    path: path.posix.join("data", "tmp-hashline-test.txt"),
    line: 2,
    side: "RIGHT",
    suggestion: "const x = foo(42);",
    content_hash: hashFromRead,
  });

  expect(calls.some((c) => c.type === "comment")).toBe(true);
});
