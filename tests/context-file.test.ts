import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runActionFlow } from "../src/app/flow.ts";
import { readConfig } from "../src/app/config.ts";
import { REVIEW_SCOPE_DECISIONS, REVIEW_SCOPE_REASON_CODES } from "../src/app/pr-data.ts";
import type { ActionConfig, PullRequestInfo, ReviewConfig, ReviewContext } from "../src/types.ts";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-test-"));
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  return dir;
}

function withEnv<T>(vars: Record<string, string>, fn: () => T): T {
  const previous = { ...process.env };
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    process.env = previous;
  }
}

const context: ReviewContext = { owner: "owner", repo: "repo", prNumber: 1 };

const prInfo: PullRequestInfo = {
  number: 1,
  title: "PR",
  body: "",
  author: "author",
  baseRef: "main",
  headRef: "feature",
  baseSha: "base",
  headSha: "head",
  url: "https://example.com/pr/1",
  labels: [],
};

const changedFiles = [
  { filename: "src/a.ts", status: "modified" as const, additions: 1, deletions: 0, changes: 1 },
];

function makeScopeResult() {
  return {
    files: changedFiles,
    warning: null,
    decision: REVIEW_SCOPE_DECISIONS.REVIEW,
    reasonCode: REVIEW_SCOPE_REASON_CODES.NO_PREVIOUS_REVIEW_SHA_REVIEW_FULL_PR,
    reason: "full PR review",
  };
}

function makeActionConfig(repoRoot: string, extra: Partial<ReviewConfig> = {}): ActionConfig {
  const review: ReviewConfig = {
    provider: "google",
    apiKey: "test",
    modelId: "model",
    maxFiles: 50,
    ignorePatterns: [],
    repoRoot,
    debug: false,
    reasoning: "off",
    ...extra,
  };
  return {
    review,
    reviewRun: [],
    commands: [],
    toolsAllowlist: [],
    outputCommentType: "both",
    learning: false,
  };
}

// ── TCTX.1: loadTeamContext ───────────────────────────────────────────────────

import { loadTeamContext } from "../src/app/team-context.ts";

test("loadTeamContext returns null when file absent at default path", () => {
  const dir = makeTempRepo();
  expect(loadTeamContext(dir, undefined)).toBeNull();
});

test("loadTeamContext returns content when .github/copilot-context.md exists", () => {
  const dir = makeTempRepo();
  fs.mkdirSync(path.join(dir, ".github"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".github", "copilot-context.md"), "Use tabs.\nNo magic numbers.", "utf8");
  const result = loadTeamContext(dir, undefined);
  expect(result).toContain("Use tabs.");
  expect(result).toContain("No magic numbers.");
});

test("loadTeamContext reads file at custom path from contextFile arg", () => {
  const dir = makeTempRepo();
  fs.mkdirSync(path.join(dir, ".github"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".github", "custom.md"), "Custom context here.", "utf8");
  expect(loadTeamContext(dir, ".github/custom.md")).toContain("Custom context here.");
});

test("loadTeamContext returns null when custom path file is absent", () => {
  const dir = makeTempRepo();
  expect(loadTeamContext(dir, ".github/missing.md")).toBeNull();
});

test("loadTeamContext trims whitespace from file content", () => {
  const dir = makeTempRepo();
  fs.mkdirSync(path.join(dir, ".github"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".github", "copilot-context.md"), "\n  Some text  \n\n", "utf8");
  expect(loadTeamContext(dir, undefined)).toBe("Some text");
});

// ── TCTX.2: buildTeamContextBlock ────────────────────────────────────────────

import { buildTeamContextBlock } from "../src/prompts/review.ts";

test("buildTeamContextBlock returns empty string for null", () => {
  expect(buildTeamContextBlock(null)).toBe("");
});

test("buildTeamContextBlock returns empty string for empty string", () => {
  expect(buildTeamContextBlock("")).toBe("");
});

test("buildTeamContextBlock wraps content in ## Team Context section", () => {
  const result = buildTeamContextBlock("Use tabs.\nNo console.log in production.");
  expect(result).toContain("## Team Context");
  expect(result).toContain("Use tabs.");
  expect(result).toContain("No console.log in production.");
});

// ── TCTX.3: config reading ────────────────────────────────────────────────────

test("readConfig: contextFile absent → config.review.contextFile is undefined", () => {
  const repoRoot = makeTempRepo();
  const config = withEnv(
    { GITHUB_WORKSPACE: repoRoot, "INPUT_PROVIDER": "anthropic", "INPUT_MODEL": "claude-sonnet-4", "INPUT_API-KEY": "test" },
    () => readConfig()
  );
  expect(config.review.contextFile).toBeUndefined();
});

test("readConfig: INPUT_CONTEXT-FILE sets config.review.contextFile", () => {
  const repoRoot = makeTempRepo();
  const config = withEnv(
    {
      GITHUB_WORKSPACE: repoRoot,
      "INPUT_PROVIDER": "anthropic",
      "INPUT_MODEL": "claude-sonnet-4",
      "INPUT_API-KEY": "test",
      "INPUT_CONTEXT-FILE": ".github/my-context.md",
    },
    () => readConfig()
  );
  expect(config.review.contextFile).toBe(".github/my-context.md");
});

test("readConfig: .reviewerc contextFile is picked up", () => {
  const repoRoot = makeTempRepo();
  fs.writeFileSync(
    path.join(repoRoot, ".reviewerc"),
    ["version: 1", "review:", "  defaults:", "    provider: anthropic", "    model: claude-sonnet-4", "    contextFile: .github/rc-context.md"].join("\n"),
    "utf8"
  );
  const config = withEnv(
    { GITHUB_WORKSPACE: repoRoot, "INPUT_API-KEY": "test" },
    () => readConfig()
  );
  expect(config.review.contextFile).toBe(".github/rc-context.md");
});

test("readConfig: action input context-file overrides .reviewerc contextFile", () => {
  const repoRoot = makeTempRepo();
  fs.writeFileSync(
    path.join(repoRoot, ".reviewerc"),
    ["version: 1", "review:", "  defaults:", "    provider: anthropic", "    model: claude-sonnet-4", "    contextFile: .github/rc-context.md"].join("\n"),
    "utf8"
  );
  const config = withEnv(
    { GITHUB_WORKSPACE: repoRoot, "INPUT_API-KEY": "test", "INPUT_CONTEXT-FILE": ".github/input-context.md" },
    () => readConfig()
  );
  expect(config.review.contextFile).toBe(".github/input-context.md");
});

// ── TCTX.4: flow pass-through ─────────────────────────────────────────────────

test("runActionFlow passes teamContext when context file is present at default path", async () => {
  const repoRoot = makeTempRepo();
  fs.mkdirSync(path.join(repoRoot, ".github"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, ".github", "copilot-context.md"), "Team rule: no magic numbers.", "utf8");

  let capturedTeamContext: string | null | undefined = "sentinel";
  await runActionFlow({
    config: makeActionConfig(repoRoot),
    context,
    octokit: {} as any,
    fetchPrDataFn: async () => ({ prInfo, changedFiles }),
    fetchExistingCommentsFn: async () => ({ existingComments: [], reviewThreads: [] }),
    fetchChangesSinceReviewFn: async () => makeScopeResult(),
    fetchReactionsForBotCommentsFn: async () => [],
    runReviewFn: async (input: any) => { capturedTeamContext = input.teamContext; },
  });

  expect(capturedTeamContext).toBe("Team rule: no magic numbers.");
});

test("runActionFlow passes null teamContext when context file is absent", async () => {
  const repoRoot = makeTempRepo();

  let capturedTeamContext: string | null | undefined = "sentinel";
  await runActionFlow({
    config: makeActionConfig(repoRoot),
    context,
    octokit: {} as any,
    fetchPrDataFn: async () => ({ prInfo, changedFiles }),
    fetchExistingCommentsFn: async () => ({ existingComments: [], reviewThreads: [] }),
    fetchChangesSinceReviewFn: async () => makeScopeResult(),
    fetchReactionsForBotCommentsFn: async () => [],
    runReviewFn: async (input: any) => { capturedTeamContext = input.teamContext; },
  });

  expect(capturedTeamContext).toBeNull();
});

test("runActionFlow uses custom contextFile path from ReviewConfig", async () => {
  const repoRoot = makeTempRepo();
  fs.mkdirSync(path.join(repoRoot, ".github"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, ".github", "custom-ctx.md"), "Custom team rule.", "utf8");

  let capturedTeamContext: string | null | undefined = "sentinel";
  await runActionFlow({
    config: makeActionConfig(repoRoot, { contextFile: ".github/custom-ctx.md" }),
    context,
    octokit: {} as any,
    fetchPrDataFn: async () => ({ prInfo, changedFiles }),
    fetchExistingCommentsFn: async () => ({ existingComments: [], reviewThreads: [] }),
    fetchChangesSinceReviewFn: async () => makeScopeResult(),
    fetchReactionsForBotCommentsFn: async () => [],
    runReviewFn: async (input: any) => { capturedTeamContext = input.teamContext; },
  });

  expect(capturedTeamContext).toBe("Custom team rule.");
});
