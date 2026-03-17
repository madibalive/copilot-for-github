import { test, expect } from "bun:test";
import { runActionFlow } from "../src/app/flow.ts";
import type { ActionConfig, ReviewConfig, ReviewContext } from "../src/types.ts";

const baseConfig: ReviewConfig = {
  provider: "google",
  apiKey: "test",
  modelId: "model",
  maxFiles: 100,
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

async function runWithPrAction(prAction: string, triggerOnUpdates: boolean | undefined): Promise<boolean> {
  let reviewCalled = false;
  const fixture = await Bun.file("tests/fixtures/harness/flow-skip.json").json();
  await runActionFlow({
    config: actionConfig,
    context,
    octokit: {} as any,
    triggerOnUpdates,
    prAction,
    fetchPrDataFn: async () => ({ prInfo: fixture.prInfo, changedFiles: fixture.changedFiles }),
    fetchExistingCommentsFn: async () => ({ existingComments: [], reviewThreads: [] }),
    fetchChangesSinceReviewFn: async () => ({
      files: fixture.changedFiles,
      warning: null,
      decision: "REVIEW",
      reasonCode: "NO_PREVIOUS_REVIEW_SHA_REVIEW_FULL_PR",
      reason: "No previous review SHA marker found.",
    }),
    runReviewFn: async () => { reviewCalled = true; },
  });
  return reviewCalled;
}

test("skips synchronize event when triggerOnUpdates is false", async () => {
  const reviewed = await runWithPrAction("synchronize", false);
  expect(reviewed).toBe(false);
});

test("does NOT skip opened event when triggerOnUpdates is false", async () => {
  const reviewed = await runWithPrAction("opened", false);
  expect(reviewed).toBe(true);
});

test("reviews synchronize event when triggerOnUpdates is true (default)", async () => {
  const reviewed = await runWithPrAction("synchronize", true);
  expect(reviewed).toBe(true);
});

test("reviews synchronize event when triggerOnUpdates is undefined (default true)", async () => {
  const reviewed = await runWithPrAction("synchronize", undefined);
  expect(reviewed).toBe(true);
});
