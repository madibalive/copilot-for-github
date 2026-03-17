import { test, expect } from "bun:test";
import { runActionFlow } from "../src/app/flow.ts";
import { REVIEW_SCOPE_DECISIONS, REVIEW_SCOPE_REASON_CODES } from "../src/app/pr-data.ts";
import type { ActionConfig, ExistingComment, ChangedFile, PullRequestInfo, ReactionSummary, ReviewConfig, ReviewContext } from "../src/types.ts";

const config: ReviewConfig = {
  provider: "google",
  apiKey: "test",
  modelId: "model",
  maxFiles: 1,
  ignorePatterns: [],
  repoRoot: process.cwd(),
  debug: false,
  reasoning: "off",
};

const actionConfig: ActionConfig = {
  review: config,
  reviewRun: [],
  commands: [],
  toolsAllowlist: [],
  outputCommentType: "both",
};

const context: ReviewContext = {
  owner: "owner",
  repo: "repo",
  prNumber: 1,
};

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
};

const files: ChangedFile[] = [
  { filename: "src/a.ts", status: "modified", additions: 1, deletions: 1, changes: 2 },
  { filename: "src/b.ts", status: "modified", additions: 1, deletions: 1, changes: 2 },
];

test("runActionFlow posts skip summary when file count exceeds max", async () => {
  let skipCalled = false;
  await runActionFlow({
    config: actionConfig,
    context,
    octokit: {} as any,
    fetchPrDataFn: async () => ({ prInfo, changedFiles: files }),
    fetchExistingCommentsFn: async () => ({ existingComments: [], reviewThreads: [] }),
    postSkipSummaryFn: async (_octokit, _context, _modelId, fileCount, maxFiles) => {
      skipCalled = true;
      expect(fileCount).toBe(2);
      expect(maxFiles).toBe(1);
    },
    runReviewFn: async () => {
      throw new Error("runReview should not be called");
    },
  });

  expect(skipCalled).toBe(true);
});

test("runActionFlow passes scope warning and previous summary into runReview", async () => {
  const comments: ExistingComment[] = [
    {
      id: 1,
      author: "bot",
      body: "## Review Summary\n\n**Verdict:** Approve\n\n<!-- sri:last-reviewed-sha:abcdef1 -->",
      url: "https://example.com/comment/1",
      type: "issue",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ];
  const scopedFiles: ChangedFile[] = [
    { filename: "src/a.ts", status: "modified", additions: 1, deletions: 1, changes: 2 },
  ];

  let captured: any = null;
  await runActionFlow({
    config: {
      ...actionConfig,
      review: { ...config, maxFiles: 5 },
    },
    context,
    octokit: {} as any,
    fetchPrDataFn: async () => ({ prInfo, changedFiles: files }),
    fetchExistingCommentsFn: async () => ({ existingComments: comments, reviewThreads: [] }),
    fetchChangesSinceReviewFn: async () => ({
      files: scopedFiles,
      warning: "Scoped warning",
      decision: REVIEW_SCOPE_DECISIONS.REVIEW,
      reasonCode: REVIEW_SCOPE_REASON_CODES.SCOPED_REVIEW,
      reason: "Scoped review",
    }),
    runReviewFn: async (input) => {
      captured = input;
    },
  });

  expect(captured).not.toBeNull();
  expect(captured.lastReviewedSha).toBe("abcdef1");
  expect(captured.scopeWarning).toBe("Scoped warning");
  expect(captured.previousVerdict).toBe("Approve");
  expect(captured.changedFiles).toEqual(scopedFiles);
  expect(captured.fullPrChangedFiles).toEqual(files);
});

test("runActionFlow posts no-new-changes summary and skips review when scope says skip", async () => {
  const comments: ExistingComment[] = [
    {
      id: 1,
      author: "bot",
      body: "## Review Summary\n\n**Verdict:** Approve\n\n<!-- sri:last-reviewed-sha:abcdef1 -->",
      url: "https://example.com/comment/1",
      type: "issue",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ];
  let summaryCalled = false;
  await runActionFlow({
    config: {
      ...actionConfig,
      review: { ...config, maxFiles: 5 },
    },
    context,
    octokit: {} as any,
    fetchPrDataFn: async () => ({ prInfo, changedFiles: files }),
    fetchExistingCommentsFn: async () => ({ existingComments: comments, reviewThreads: [] }),
    fetchChangesSinceReviewFn: async () => ({
      files: [],
      warning: "History diverged",
      decision: REVIEW_SCOPE_DECISIONS.SKIP_CONFIDENT,
      reasonCode: REVIEW_SCOPE_REASON_CODES.LOCAL_TWO_DOT_NO_PR_FILE_CHANGES_SKIP,
      reason: "Push appears to be rebase/merge-only.",
    }),
    postNoNewChangesSummaryFn: async (_octokit, _context, _modelId, reviewSha, reason) => {
      summaryCalled = true;
      expect(reviewSha).toBe("head");
      expect(reason).toContain("rebase/merge-only");
    },
    runReviewFn: async () => {
      throw new Error("runReview should not be called");
    },
  });

  expect(summaryCalled).toBe(true);
});

test("runActionFlow logs scope shadow telemetry for review decisions", async () => {
  const comments: ExistingComment[] = [
    {
      id: 1,
      author: "bot",
      body: "## Review Summary\n\n**Verdict:** Approve\n\n<!-- sri:last-reviewed-sha:abcdef1 -->",
      url: "https://example.com/comment/1",
      type: "issue",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ];
  const logs: string[] = [];
  await runActionFlow({
    config: {
      ...actionConfig,
      review: { ...config, maxFiles: 5 },
    },
    context,
    octokit: {} as any,
    fetchPrDataFn: async () => ({ prInfo, changedFiles: files }),
    fetchExistingCommentsFn: async () => ({ existingComments: comments, reviewThreads: [] }),
    fetchChangesSinceReviewFn: async () => ({
      files: [files[0]],
      warning: null,
      decision: REVIEW_SCOPE_DECISIONS.REVIEW,
      reasonCode: REVIEW_SCOPE_REASON_CODES.SCOPED_REVIEW,
      reason: "Scoped review",
    }),
    runReviewFn: async () => {},
    logInfo: (message) => logs.push(message),
  });

  const line = logs.find((entry) => entry.includes("[scope-shadow]"));
  expect(line).toBeTruthy();
  expect(line).toContain("mode=review");
  expect(line).toContain("decision=review");
  expect(line).toContain("always_review_files_after_ignore=2");
  expect(line).toContain("file_delta_vs_always_review=1");
});

// ── TPOL.1: learning integration tests ───────────────────────────────────────

const learningReviewConfig: ReviewConfig = { ...config, maxFiles: 50 };
const botCommentWithMarker: ExistingComment = {
  id: 42,
  author: "copilot[bot]",
  body: "<!-- sri:bot-comment --> Missing null check",
  url: "",
  type: "issue",
  updatedAt: "2026-03-01T00:00:00Z",
};
const strongNegativeReaction: ReactionSummary = {
  commentId: 42,
  commentBody: "<!-- sri:bot-comment --> Missing null check",
  thumbsUp: 0,
  thumbsDown: 3,
  netScore: -3,
};
const learningFiles: ChangedFile[] = [{ filename: "src/x.ts", status: "modified", additions: 1, deletions: 0, changes: 1 }];
const learningPrInfo: PullRequestInfo = { ...prInfo, headSha: "head2", labels: [] };

function makeLearningScope() {
  return {
    files: learningFiles,
    warning: null,
    decision: REVIEW_SCOPE_DECISIONS.REVIEW,
    reasonCode: REVIEW_SCOPE_REASON_CODES.NO_PREVIOUS_REVIEW_SHA_REVIEW_FULL_PR,
    reason: "full PR review",
  };
}

test("learning: true with strong reactions → learnedPrefs passed with suppressions", async () => {
  let capturedPrefs: any = "not-set";
  await runActionFlow({
    config: { ...actionConfig, review: learningReviewConfig, learning: true },
    context,
    octokit: {} as any,
    fetchPrDataFn: async () => ({ prInfo: learningPrInfo, changedFiles: learningFiles }),
    fetchExistingCommentsFn: async () => ({ existingComments: [botCommentWithMarker], reviewThreads: [] }),
    fetchReactionsForBotCommentsFn: async () => [strongNegativeReaction],
    fetchChangesSinceReviewFn: async () => makeLearningScope(),
    runReviewFn: async (input) => { capturedPrefs = input.learnedPrefs; },
  });
  expect(capturedPrefs).not.toBeNull();
  expect(capturedPrefs?.suppressions?.length).toBeGreaterThan(0);
});

test("learning: false → learnedPrefs is null when passed to runReviewFn", async () => {
  let capturedPrefs: any = "not-set";
  await runActionFlow({
    config: { ...actionConfig, review: learningReviewConfig, learning: false },
    context,
    octokit: {} as any,
    fetchPrDataFn: async () => ({ prInfo: learningPrInfo, changedFiles: learningFiles }),
    fetchExistingCommentsFn: async () => ({ existingComments: [botCommentWithMarker], reviewThreads: [] }),
    fetchReactionsForBotCommentsFn: async () => [strongNegativeReaction],
    fetchChangesSinceReviewFn: async () => makeLearningScope(),
    runReviewFn: async (input) => { capturedPrefs = input.learnedPrefs; },
  });
  expect(capturedPrefs == null).toBe(true);
});

test("learning: true + repo.write not in allowlist → logs warning, no commit attempted", async () => {
  const logMessages: string[] = [];
  let commitAttempted = false;
  await runActionFlow({
    config: { ...actionConfig, review: learningReviewConfig, toolsAllowlist: [], learning: true },
    context,
    octokit: {
      rest: {
        repos: {
          getContent: async () => { commitAttempted = true; },
          createOrUpdateFileContents: async () => { commitAttempted = true; },
        },
      },
    } as any,
    fetchPrDataFn: async () => ({ prInfo: learningPrInfo, changedFiles: learningFiles }),
    fetchExistingCommentsFn: async () => ({ existingComments: [botCommentWithMarker], reviewThreads: [] }),
    fetchReactionsForBotCommentsFn: async () => [strongNegativeReaction],
    fetchChangesSinceReviewFn: async () => makeLearningScope(),
    runReviewFn: async () => {},
    logInfo: (msg) => logMessages.push(msg),
  });
  expect(commitAttempted).toBe(false);
  expect(logMessages.some((m) => m.toLowerCase().includes("warn") || m.toLowerCase().includes("repo.write"))).toBe(true);
});

test("runActionFlow logs scope shadow telemetry for skip decisions", async () => {
  const comments: ExistingComment[] = [
    {
      id: 1,
      author: "bot",
      body: "## Review Summary\n\n**Verdict:** Approve\n\n<!-- sri:last-reviewed-sha:abcdef1 -->",
      url: "https://example.com/comment/1",
      type: "issue",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ];
  const logs: string[] = [];
  await runActionFlow({
    config: {
      ...actionConfig,
      review: { ...config, maxFiles: 5 },
    },
    context,
    octokit: {} as any,
    fetchPrDataFn: async () => ({ prInfo, changedFiles: files }),
    fetchExistingCommentsFn: async () => ({ existingComments: comments, reviewThreads: [] }),
    fetchChangesSinceReviewFn: async () => ({
      files: [],
      warning: null,
      decision: REVIEW_SCOPE_DECISIONS.SKIP_CONFIDENT,
      reasonCode: REVIEW_SCOPE_REASON_CODES.LOCAL_TWO_DOT_NO_PR_FILE_CHANGES_SKIP,
      reason: "No changes",
    }),
    postNoNewChangesSummaryFn: async () => {},
    runReviewFn: async () => {
      throw new Error("runReview should not be called");
    },
    logInfo: (message) => logs.push(message),
  });

  const line = logs.find((entry) => entry.includes("[scope-shadow]"));
  expect(line).toBeTruthy();
  expect(line).toContain("mode=skip");
  expect(line).toContain("decision=skip_confident");
  expect(line).toContain("always_review_files_after_ignore=2");
  expect(line).toContain("file_delta_vs_always_review=2");
});
