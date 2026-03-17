import { test, expect } from "bun:test";
import {
  fetchChangesSinceReview,
  fetchExistingComments,
  fetchPrData,
  fetchReactionsForBotComments,
  REVIEW_SCOPE_DECISIONS,
  REVIEW_SCOPE_REASON_CODES,
} from "../src/app/pr-data.ts";
import type { ReviewContext, ChangedFile } from "../src/types.ts";

const context: ReviewContext = {
  owner: "owner",
  repo: "repo",
  prNumber: 1,
};

test("fetchChangesSinceReview skips when last reviewed SHA matches current head", async () => {
  const result = await fetchChangesSinceReview(
    {} as any,
    context,
    "same-sha",
    "same-sha",
    []
  );

  expect(result.files).toEqual([]);
  expect(result.warning).toBeNull();
  expect(result.decision).toBe(REVIEW_SCOPE_DECISIONS.SKIP_CONFIDENT);
  expect(result.reasonCode).toBe(REVIEW_SCOPE_REASON_CODES.BASE_EQUALS_HEAD_SKIP);
});

test("fetchExistingComments throws on GraphQL failure", async () => {
  const issueComments = [
    {
      id: 1,
      user: { login: "alice" },
      body: "Issue comment",
      html_url: "https://example.com/issue/1",
      updated_at: "2026-01-01T00:00:00Z",
      created_at: "2026-01-01T00:00:00Z",
    },
  ];
  const reviewComments = [
    {
      id: 10,
      user: { login: "bob" },
      body: "Root",
      html_url: "https://example.com/review/10",
      path: "src/index.ts",
      line: 5,
      side: "RIGHT",
      updated_at: "2026-01-02T00:00:00Z",
      created_at: "2026-01-02T00:00:00Z",
    },
    {
      id: 11,
      user: { login: "carol" },
      body: "Reply",
      html_url: "https://example.com/review/11",
      path: "src/index.ts",
      line: 5,
      side: "RIGHT",
      in_reply_to_id: 10,
      updated_at: "2026-01-03T00:00:00Z",
      created_at: "2026-01-03T00:00:00Z",
    },
  ];

  const octokit = {
    rest: {
      issues: { listComments: () => ({}) },
      pulls: { listReviewComments: () => ({}) },
    },
    paginate: async (fn: any) => {
      if (fn === octokit.rest.issues.listComments) return issueComments;
      if (fn === octokit.rest.pulls.listReviewComments) return reviewComments;
      return [];
    },
    graphql: async () => {
      throw new Error("GraphQL error");
    },
  };

  let error: unknown = null;
  try {
    await fetchExistingComments(octokit as any, context);
  } catch (err) {
    error = err;
  }

  expect(error).toBeTruthy();
});

test("fetchChangesSinceReview returns warning on 404 compare", async () => {
  const fallbackFiles: ChangedFile[] = [
    { filename: "src/index.ts", status: "modified", additions: 1, deletions: 1, changes: 2 },
  ];
  const octokit = {
    rest: {
      repos: {
        compareCommits: async () => {
          const error: any = new Error("Not Found");
          error.status = 404;
          error.response = { status: 404 };
          throw error;
        },
      },
    },
  };

  const result = await fetchChangesSinceReview(
    octokit as any,
    context,
    "base",
    "head",
    fallbackFiles
  );

  expect(result.files).toEqual(fallbackFiles);
  expect(result.warning).toContain("Previous review SHA no longer exists");
  expect(result.decision).toBe(REVIEW_SCOPE_DECISIONS.REVIEW);
  expect(result.reasonCode).toBe(REVIEW_SCOPE_REASON_CODES.COMPARE_404_REVIEW_FULL_PR);
});

test("fetchChangesSinceReview falls back to full PR diff when compare has empty files", async () => {
  const fallbackFiles: ChangedFile[] = [
    { filename: "src/index.ts", status: "modified", additions: 1, deletions: 1, changes: 2 },
  ];
  const octokit = {
    rest: {
      repos: {
        compareCommits: async () => ({
          data: {
            status: "ahead",
            ahead_by: 1,
            behind_by: 0,
            files: [],
          },
        }),
      },
    },
  };

  const result = await fetchChangesSinceReview(
    octokit as any,
    context,
    "base",
    "head",
    fallbackFiles
  );

  expect(result.files).toEqual(fallbackFiles);
  expect(result.decision).toBe(REVIEW_SCOPE_DECISIONS.REVIEW);
  expect(result.reasonCode).toBe(REVIEW_SCOPE_REASON_CODES.COMPARE_EMPTY_REVIEW_FULL_PR);
});

test("fetchChangesSinceReview only returns files still present in current PR diff", async () => {
  const fallbackFiles: ChangedFile[] = [
    { filename: "src/index.ts", status: "modified", additions: 1, deletions: 1, changes: 2, patch: "@@ -1 +1 @@" },
  ];
  const octokit = {
    rest: {
      repos: {
        compareCommits: async () => ({
          data: {
            status: "ahead",
            behind_by: 0,
            files: [
              {
                filename: "src/index.ts",
                status: "modified",
                additions: 10,
                deletions: 10,
                changes: 20,
                patch: "compare patch that should not be used",
              },
              {
                filename: "src/from-main.ts",
                status: "modified",
                additions: 5,
                deletions: 0,
                changes: 5,
              },
            ],
          },
        }),
      },
    },
  };

  const result = await fetchChangesSinceReview(
    octokit as any,
    context,
    "base",
    "head",
    fallbackFiles
  );

  expect(result.warning).toBeNull();
  expect(result.files).toEqual(fallbackFiles);
  expect(result.decision).toBe(REVIEW_SCOPE_DECISIONS.REVIEW);
  expect(result.reasonCode).toBe(REVIEW_SCOPE_REASON_CODES.SCOPED_REVIEW);
});

test("fetchChangesSinceReview warns and scopes to PR diff when history diverged", async () => {
  const fallbackFiles: ChangedFile[] = [
    { filename: "src/index.ts", status: "modified", additions: 1, deletions: 1, changes: 2 },
    { filename: "src/other.ts", status: "modified", additions: 1, deletions: 1, changes: 2 },
  ];
  const octokit = {
    rest: {
      repos: {
        compareCommits: async () => ({
          data: {
            status: "diverged",
            behind_by: 1,
            files: [
              {
                filename: "src/index.ts",
                status: "modified",
                additions: 1,
                deletions: 1,
                changes: 2,
              },
              {
                filename: "src/from-main.ts",
                status: "modified",
                additions: 3,
                deletions: 0,
                changes: 3,
              },
            ],
          },
        }),
      },
    },
  };

  const result = await fetchChangesSinceReview(
    octokit as any,
    context,
    "base",
    "head",
    fallbackFiles
  );

  expect(result.decision).toBe(REVIEW_SCOPE_DECISIONS.REVIEW);
  expect(result.files).toEqual([fallbackFiles[0]]);
  expect(result.warning).toContain("Scoped to current PR diff");
  expect(result.reasonCode).toBe(REVIEW_SCOPE_REASON_CODES.DIVERGED_SCOPED_REVIEW);
});

test("fetchChangesSinceReview stays on review path for diverged updates without local verification", async () => {
  const fallbackFiles: ChangedFile[] = [
    { filename: "src/index.ts", status: "modified", additions: 1, deletions: 1, changes: 2 },
  ];
  const octokit = {
    rest: {
      repos: {
        compareCommits: async () => ({
          data: {
            status: "diverged",
            ahead_by: 4,
            behind_by: 1,
            files: [
              {
                filename: "src/index.ts",
                status: "modified",
                additions: 1,
                deletions: 1,
                changes: 2,
              },
              {
                filename: "src/from-main.ts",
                status: "modified",
                additions: 3,
                deletions: 0,
                changes: 3,
              },
            ],
          },
        }),
      },
    },
  };

  const result = await fetchChangesSinceReview(
    octokit as any,
    context,
    "base",
    "head",
    fallbackFiles
  );

  expect(result.files).toEqual(fallbackFiles);
  expect(result.decision).toBe(REVIEW_SCOPE_DECISIONS.REVIEW);
  expect(result.reasonCode).toBe(REVIEW_SCOPE_REASON_CODES.DIVERGED_SCOPED_REVIEW);
  expect(result.warning).toContain("Scoped to current PR diff");
});

function makePrOctokit(labels: Array<{ name: string }>) {
  return {
    rest: {
      pulls: {
        get: async () => ({
          data: {
            number: 1,
            title: "Test PR",
            body: "body",
            user: { login: "alice" },
            base: { ref: "main", sha: "base-sha" },
            head: { ref: "feature/foo", sha: "head-sha" },
            html_url: "https://github.com/owner/repo/pull/1",
            labels,
          },
        }),
        listFiles: async () => ({ data: [] }),
      },
    },
    paginate: async (_fn: any, _params: any) => [],
    graphql: async () => ({ repository: { pullRequest: { reviewThreads: { nodes: [] } } } }),
  };
}

test("fetchPrData maps PR labels to PullRequestInfo.labels", async () => {
  const octokit = makePrOctokit([{ name: "bug" }, { name: "review-needed" }]);
  const { prInfo } = await fetchPrData(octokit as any, context);
  expect(prInfo.labels).toEqual(["bug", "review-needed"]);
});

test("fetchPrData returns empty labels array when PR has no labels", async () => {
  const octokit = makePrOctokit([]);
  const { prInfo } = await fetchPrData(octokit as any, context);
  expect(prInfo.labels).toEqual([]);
});

// ── fetchReactionsForBotComments (TUS2.2) ────────────────────────────────────

test("fetchReactionsForBotComments returns empty array when no bot comments", async () => {
  const comments = [
    { id: 1, body: "Regular human comment", author: "alice" },
    { id: 2, body: "Another human comment", author: "bob" },
  ];
  const octokit = {
    rest: { reactions: { listForIssueComment: async () => ({ data: [] }) } },
  };
  const result = await fetchReactionsForBotComments(octokit as any, context, comments as any);
  expect(result).toEqual([]);
});

test("fetchReactionsForBotComments only fetches reactions for bot comments", async () => {
  const BOT_MARKER = "<!-- sri:bot-comment -->";
  const comments = [
    { id: 1, body: `Human comment` },
    { id: 2, body: `Bot comment ${BOT_MARKER}` },
    { id: 3, body: `Another bot comment ${BOT_MARKER}` },
  ];
  const reactionCalls: number[] = [];
  const octokit = {
    rest: {
      reactions: {
        listForIssueComment: async ({ comment_id }: { comment_id: number }) => {
          reactionCalls.push(comment_id);
          return { data: [] };
        },
      },
    },
  };
  await fetchReactionsForBotComments(octokit as any, context, comments as any);
  expect(reactionCalls).toEqual(expect.arrayContaining([2, 3]));
  expect(reactionCalls).not.toContain(1);
});

test("fetchReactionsForBotComments counts +1 and -1 reactions correctly", async () => {
  const BOT_MARKER = "<!-- sri:bot-comment -->";
  const comments = [
    { id: 10, body: `Bot said something ${BOT_MARKER}` },
  ];
  const octokit = {
    rest: {
      reactions: {
        listForIssueComment: async () => ({
          data: [
            { content: "+1" },
            { content: "+1" },
            { content: "-1" },
            { content: "laugh" }, // neutral — ignored
          ],
        }),
      },
    },
  };
  const result = await fetchReactionsForBotComments(octokit as any, context, comments as any);
  expect(result).toHaveLength(1);
  expect(result[0].commentId).toBe(10);
  expect(result[0].thumbsUp).toBe(2);
  expect(result[0].thumbsDown).toBe(1);
  expect(result[0].netScore).toBe(1);
});

test("fetchReactionsForBotComments includes commentBody in result", async () => {
  const BOT_MARKER = "<!-- sri:bot-comment -->";
  const comments = [
    { id: 5, body: `Review note about auth handling ${BOT_MARKER}` },
  ];
  const octokit = {
    rest: { reactions: { listForIssueComment: async () => ({ data: [{ content: "+1" }] }) } },
  };
  const result = await fetchReactionsForBotComments(octokit as any, context, comments as any);
  expect(result[0].commentBody).toContain("Review note about auth handling");
});
