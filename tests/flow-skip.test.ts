import { test, expect } from "bun:test";
import { runActionFlow } from "../src/app/flow.ts";
import type { ActionConfig, ReviewConfig, ReviewContext } from "../src/types.ts";

const baseConfig: ReviewConfig = {
  provider: "google",
  apiKey: "test",
  modelId: "model",
  maxFiles: 5,
  ignorePatterns: ["**/*.snap"],
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

const context: ReviewContext = {
  owner: "owner",
  repo: "repo",
  prNumber: 99,
};

async function loadFixture() {
  return Bun.file("tests/fixtures/harness/flow-skip.json").json();
}

test("runActionFlow skips and posts filter comment when author excluded", async () => {
  const fixture = await loadFixture();
  let filterSkipCalled = false;
  let reviewCalled = false;
  await runActionFlow({
    config: actionConfig,
    context,
    octokit: {} as any,
    authorFilters: { exclude: ["dev"] },
    fetchPrDataFn: async () => ({ prInfo: fixture.prInfo, changedFiles: fixture.changedFiles }),
    fetchExistingCommentsFn: async () => { throw new Error("should not be called"); },
    postPrFilterSkipSummaryFn: async (_octokit, _context, _modelId, reason) => {
      filterSkipCalled = true;
      expect(reason).toContain("dev");
    },
    runReviewFn: async () => { reviewCalled = true; },
  });
  expect(filterSkipCalled).toBe(true);
  expect(reviewCalled).toBe(false);
});

test("runActionFlow skips and posts filter comment when skipKeyword in title", async () => {
  const fixture = await loadFixture();
  let filterSkipCalled = false;
  await runActionFlow({
    config: actionConfig,
    context,
    octokit: {} as any,
    keywordFilters: { skipKeywords: ["Big PR"] },
    fetchPrDataFn: async () => ({ prInfo: fixture.prInfo, changedFiles: fixture.changedFiles }),
    fetchExistingCommentsFn: async () => { throw new Error("should not be called"); },
    postPrFilterSkipSummaryFn: async () => { filterSkipCalled = true; },
    runReviewFn: async () => { throw new Error("review should not run"); },
  });
  expect(filterSkipCalled).toBe(true);
});

test("runActionFlow does NOT skip when author passes filters", async () => {
  const fixture = await loadFixture();
  let reviewCalled = false;
  await runActionFlow({
    config: { ...actionConfig, review: { ...baseConfig, maxFiles: 100 } },
    context,
    octokit: {} as any,
    authorFilters: { exclude: ["dependabot[bot]"] },
    fetchPrDataFn: async () => ({ prInfo: fixture.prInfo, changedFiles: fixture.changedFiles }),
    fetchExistingCommentsFn: async () => ({ existingComments: [], reviewThreads: [] }),
    fetchChangesSinceReviewFn: async () => ({
      files: fixture.changedFiles,
      warning: null,
      decision: "REVIEW",
      reasonCode: "NO_PREVIOUS_REVIEW_SHA_REVIEW_FULL_PR",
      reason: "No previous review SHA marker found.",
    }),
    postPrFilterSkipSummaryFn: async () => { throw new Error("should not skip"); },
    runReviewFn: async () => { reviewCalled = true; },
  });
  expect(reviewCalled).toBe(true);
});

test("runActionFlow skips when PR has excluded label", async () => {
  const fixture = await loadFixture();
  const prInfoWithLabel = { ...fixture.prInfo, labels: ["wip", "bug"] };
  let filterSkipCalled = false;
  await runActionFlow({
    config: actionConfig,
    context,
    octokit: {} as any,
    labelFilters: { exclude: ["wip"] },
    fetchPrDataFn: async () => ({ prInfo: prInfoWithLabel, changedFiles: fixture.changedFiles }),
    fetchExistingCommentsFn: async () => { throw new Error("should not be called"); },
    postPrFilterSkipSummaryFn: async () => { filterSkipCalled = true; },
    runReviewFn: async () => { throw new Error("review should not run"); },
  });
  expect(filterSkipCalled).toBe(true);
});

test("runActionFlow skips large PR after ignore filtering", async () => {
  const fixture = await Bun.file("tests/fixtures/harness/flow-skip.json").json();
  let skipped = false;
  await runActionFlow({
    config: actionConfig,
    context,
    octokit: {} as any,
    fetchPrDataFn: async () => ({ prInfo: fixture.prInfo, changedFiles: fixture.changedFiles }),
    fetchExistingCommentsFn: async () => ({ existingComments: [], reviewThreads: [] }),
    postSkipSummaryFn: async (_octokit, _context, _modelId, fileCount, maxFiles) => {
      skipped = true;
      expect(fileCount).toBe(7);
      expect(maxFiles).toBe(5);
    },
    runReviewFn: async () => {
      throw new Error("runReview should not be called");
    },
  });

  expect(skipped).toBe(true);
});
