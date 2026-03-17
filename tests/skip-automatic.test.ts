import { test, expect } from "bun:test";
import { runActionFlow } from "../src/app/flow.ts";
import type { ActionConfig, ReviewConfig, ReviewContext } from "../src/types.ts";

const baseConfig: ReviewConfig = {
  provider: "google",
  apiKey: "test",
  modelId: "model",
  maxFiles: 50,
  ignorePatterns: [],
  repoRoot: process.cwd(),
  debug: false,
  reasoning: "off",
};

const actionConfig: ActionConfig = {
  review: baseConfig,
  reviewRun: [],
  commands: [],
  toolsAllowlist: [],
  outputCommentType: "both",
};

const context: ReviewContext = { owner: "owner", repo: "repo", prNumber: 1 };

test("runActionFlow skips when skipAutomatic is true", async () => {
  let reviewCalled = false;
  await runActionFlow({
    config: actionConfig,
    context,
    octokit: {} as any,
    skipAutomatic: true,
    runReviewFn: async () => {
      reviewCalled = true;
    },
    fetchPrDataFn: async () => { throw new Error("fetchPrData should not be called"); },
    fetchExistingCommentsFn: async () => { throw new Error("fetchExistingComments should not be called"); },
  });
  expect(reviewCalled).toBe(false);
});

test("runActionFlow does NOT skip when skipAutomatic is false (default)", async () => {
  const fixture = await Bun.file("tests/fixtures/harness/flow-skip.json").json();
  let reviewCalled = false;
  await runActionFlow({
    config: { ...actionConfig, review: { ...baseConfig, maxFiles: 100 } },
    context,
    octokit: {} as any,
    skipAutomatic: false,
    fetchPrDataFn: async () => ({ prInfo: fixture.prInfo, changedFiles: fixture.changedFiles }),
    fetchExistingCommentsFn: async () => ({ existingComments: [], reviewThreads: [] }),
    fetchChangesSinceReviewFn: async () => ({
      files: fixture.changedFiles,
      warning: null,
      decision: "REVIEW",
      reasonCode: "NO_PREVIOUS_REVIEW_SHA_REVIEW_FULL_PR",
      reason: "No previous review SHA marker found.",
    }),
    runReviewFn: async () => {
      reviewCalled = true;
    },
  });
  expect(reviewCalled).toBe(true);
});

test("runActionFlow skips when skipAutomatic is true and does not call fetchPrData", async () => {
  let fetchCalled = false;
  await runActionFlow({
    config: actionConfig,
    context,
    octokit: {} as any,
    skipAutomatic: true,
    fetchPrDataFn: async () => {
      fetchCalled = true;
      throw new Error("should not be reached");
    },
  });
  expect(fetchCalled).toBe(false);
});
