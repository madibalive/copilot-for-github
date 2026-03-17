import type {
  ActionConfig,
  ChangedFile,
  CommentType,
  ExistingComment,
  IncludeExclude,
  LearnedPrefs,
  PullRequestInfo,
  ReviewConfig,
  ReviewContext,
  ReviewThreadInfo,
  ToolCategory,
} from "../types.js";
import type * as github from "@actions/github";
import {
  fetchChangesSinceReview,
  fetchExistingComments,
  fetchReactionsForBotComments,
  fetchPrData,
  REVIEW_SCOPE_DECISIONS,
  REVIEW_SCOPE_REASON_CODES,
} from "./pr-data.js";
import { findLastReviewedSha, findLastSummary } from "./last-review.js";
import { loadLearnedPrefs, mergeReactionsIntoPrefs } from "./learned-prefs.js";
import { loadTeamContext } from "./team-context.js";
import { applyIgnorePatterns } from "./ignore.js";
import { postNoNewChangesSummary, postPrFilterSkipSummary, postSkipSummary } from "./summary.js";
import { passesAuthorFilter, passesBranchFilter, passesKeywordFilter, passesLabelFilter } from "./pr-filters.js";
import type { KeywordFilters } from "./pr-filters.js";
import { runReview } from "../agent.js";
import type { CommandRegistry } from "../commands/registry.js";
import { runCommand } from "../commands/command-runner.js";

export async function runActionFlow(params: {
  config: ActionConfig;
  context: ReviewContext;
  octokit: ReturnType<typeof github.getOctokit>;
  logDebug?: (message: string) => void;
  fetchPrDataFn?: typeof fetchPrData;
  fetchExistingCommentsFn?: typeof fetchExistingComments;
  fetchChangesSinceReviewFn?: typeof fetchChangesSinceReview;
  fetchReactionsForBotCommentsFn?: typeof fetchReactionsForBotComments;
  runReviewFn?: typeof runReview;
  postSkipSummaryFn?: typeof postSkipSummary;
  postNoNewChangesSummaryFn?: typeof postNoNewChangesSummary;
  commandIds?: string[];
  commandRegistry?: CommandRegistry;
  runCommandFn?: typeof runCommand;
  toolsAllowlist?: ToolCategory[];
  defaultCommentType?: CommentType;
  logInfo?: (message: string) => void;
  skipAutomatic?: boolean;
  triggerOnUpdates?: boolean;
  prAction?: string;
  authorFilters?: IncludeExclude;
  keywordFilters?: KeywordFilters;
  baseBranchFilters?: IncludeExclude;
  headBranchFilters?: IncludeExclude;
  labelFilters?: IncludeExclude;
  postPrFilterSkipSummaryFn?: typeof postPrFilterSkipSummary;
}): Promise<void> {
  if (params.skipAutomatic) {
    (params.logInfo ?? console.info)("[skip] skip-automatic is enabled; skipping automated review trigger.");
    return;
  }
  if ((params.triggerOnUpdates ?? true) === false && params.prAction === "synchronize") {
    (params.logInfo ?? console.info)("[skip] trigger-on-updates is false; skipping synchronize event.");
    return;
  }
  const { config, context, octokit } = params;
  const reviewConfig: ReviewConfig = config.review;
  const fetchPrDataImpl = params.fetchPrDataFn ?? fetchPrData;
  const fetchExistingCommentsImpl = params.fetchExistingCommentsFn ?? fetchExistingComments;
  const fetchChangesSinceReviewImpl = params.fetchChangesSinceReviewFn ?? fetchChangesSinceReview;
  const runReviewImpl = params.runReviewFn ?? runReview;
  const postSkipSummaryImpl = params.postSkipSummaryFn ?? postSkipSummary;
  const postNoNewChangesSummaryImpl = params.postNoNewChangesSummaryFn ?? postNoNewChangesSummary;
  const postPrFilterSkipSummaryImpl = params.postPrFilterSkipSummaryFn ?? postPrFilterSkipSummary;
  const runCommandImpl = params.runCommandFn ?? runCommand;
  const logInfo = params.logInfo ?? console.info;

  const { prInfo, changedFiles } = await fetchPrDataImpl(octokit, context);

  if (!passesAuthorFilter(prInfo.author, params.authorFilters)) {
    logInfo(`[pr-filter] Skipping PR #${prInfo.number}: author '${prInfo.author}' excluded by author filters.`);
    await postPrFilterSkipSummaryImpl(octokit, context, reviewConfig.modelId, `Author '${prInfo.author}' excluded by author filter.`);
    return;
  }
  if (!passesKeywordFilter(prInfo.title, prInfo.body, params.keywordFilters)) {
    logInfo(`[pr-filter] Skipping PR #${prInfo.number}: title/body excluded by keyword filters.`);
    await postPrFilterSkipSummaryImpl(octokit, context, reviewConfig.modelId, "PR title or body excluded by keyword filter.");
    return;
  }
  if (!passesBranchFilter(prInfo.baseRef, params.baseBranchFilters)) {
    logInfo(`[pr-filter] Skipping PR #${prInfo.number}: base branch '${prInfo.baseRef}' excluded by branch filters.`);
    await postPrFilterSkipSummaryImpl(octokit, context, reviewConfig.modelId, `Base branch '${prInfo.baseRef}' excluded by branch filter.`);
    return;
  }
  if (!passesBranchFilter(prInfo.headRef, params.headBranchFilters)) {
    logInfo(`[pr-filter] Skipping PR #${prInfo.number}: head branch '${prInfo.headRef}' excluded by branch filters.`);
    await postPrFilterSkipSummaryImpl(octokit, context, reviewConfig.modelId, `Head branch '${prInfo.headRef}' excluded by branch filter.`);
    return;
  }
  if (!passesLabelFilter(prInfo.labels, params.labelFilters)) {
    logInfo(`[pr-filter] Skipping PR #${prInfo.number}: labels excluded by label filters.`);
    await postPrFilterSkipSummaryImpl(octokit, context, reviewConfig.modelId, "PR labels excluded by label filter.");
    return;
  }

  const { existingComments, reviewThreads } = await fetchExistingCommentsImpl(octokit, context);
  const fetchReactionsImpl = params.fetchReactionsForBotCommentsFn ?? fetchReactionsForBotComments;
  const botCommentReactions = await fetchReactionsImpl(octokit, context, existingComments, logInfo);
  const learnedPrefs = config.learning
    ? mergeReactionsIntoPrefs(loadLearnedPrefs(reviewConfig.repoRoot), botCommentReactions)
    : null;
  const teamContext = loadTeamContext(reviewConfig.repoRoot, reviewConfig.contextFile);
  const lastReviewedSha = findLastReviewedSha(existingComments);
  const lastSummary = findLastSummary(existingComments);
  const scopedResult = lastReviewedSha
    ? await fetchChangesSinceReviewImpl(octokit, context, lastReviewedSha, prInfo.headSha, changedFiles, {
      repoRoot: reviewConfig.repoRoot,
    })
    : {
      files: changedFiles,
      warning: null,
      decision: REVIEW_SCOPE_DECISIONS.REVIEW,
      reasonCode: REVIEW_SCOPE_REASON_CODES.NO_PREVIOUS_REVIEW_SHA_REVIEW_FULL_PR,
      reason: "No previous review SHA marker found. Reviewing current PR diff.",
    };

  if (reviewConfig.debug && params.logDebug) {
    params.logDebug(`[debug] PR #${prInfo.number} ${prInfo.title}`);
    params.logDebug(`[debug] Files in PR: ${changedFiles.length}`);
    if (lastReviewedSha) {
      params.logDebug(`[debug] Last reviewed SHA: ${lastReviewedSha}`);
      params.logDebug(`[debug] Files since last review: ${scopedResult.files.length}`);
      params.logDebug(`[debug] Scope decision: ${scopedResult.decision} (${scopedResult.reasonCode})`);
    }
    params.logDebug(`[debug] Existing comments: ${existingComments.length}`);
  }

  const filtered = applyIgnorePatterns(scopedResult.files, reviewConfig.ignorePatterns);
  const filteredFullPrFiles = applyIgnorePatterns(changedFiles, reviewConfig.ignorePatterns);
  logScopeShadowTelemetry({
    logInfo,
    prNumber: prInfo.number,
    lastReviewedSha,
    headSha: prInfo.headSha,
    decision: scopedResult.decision,
    reasonCode: scopedResult.reasonCode,
    scopedFilesBeforeIgnore: scopedResult.files.length,
    scopedFilesAfterIgnore: filtered.length,
    fullPrFilesAfterIgnore: filteredFullPrFiles.length,
  });
  if (scopedResult.decision === REVIEW_SCOPE_DECISIONS.SKIP_CONFIDENT) {
    await postNoNewChangesSummaryImpl(
      octokit,
      context,
      reviewConfig.modelId,
      prInfo.headSha,
      scopedResult.reason
    );
    return;
  }
  if (filtered.length > reviewConfig.maxFiles) {
    await postSkipSummaryImpl(octokit, context, reviewConfig.modelId, filtered.length, reviewConfig.maxFiles);
    return;
  }

  await runReviewImpl({
    config: reviewConfig,
    context,
    octokit,
    prInfo,
    changedFiles: filtered,
    fullPrChangedFiles: filteredFullPrFiles,
    existingComments,
    reviewThreads,
    lastReviewedSha,
    scopeWarning: scopedResult.warning ?? null,
    previousVerdict: lastSummary?.verdict ?? null,
    previousReviewUrl: lastSummary?.url ?? null,
    previousReviewAt: lastSummary?.updatedAt ?? null,
    previousReviewBody: lastSummary?.body ?? null,
    toolAllowlist: params.toolsAllowlist,
    learnedPrefs,
    teamContext,
  });

  const effectiveAllowlist = params.toolsAllowlist ?? config.toolsAllowlist ?? [];
  if (config.learning && learnedPrefs) {
    if (effectiveAllowlist.includes("repo.write")) {
      await commitLearnedPrefs(octokit, context, learnedPrefs, logInfo);
    } else {
      logInfo("[warn] learning is enabled but repo.write is not in the tools allowlist — learned preferences will not be persisted.");
    }
  }

  if (params.commandIds && params.commandIds.length > 0 && params.commandRegistry) {
    for (const commandId of params.commandIds) {
      const command = params.commandRegistry.get(commandId);
      if (!command) {
        logInfo(`[warn] Unknown command id in review.run: ${commandId}`);
        continue;
      }
      const commentType = command.comment?.type ?? params.defaultCommentType ?? "both";
      await runCommandImpl({
        mode: "pr",
        command,
        config: reviewConfig,
        context,
        octokit,
        prInfo,
        changedFiles: filtered,
        existingComments,
        reviewThreads,
        commentType,
        allowlist: params.toolsAllowlist ?? [],
      });
    }
  }
}

export type { ChangedFile, ExistingComment, PullRequestInfo, ReviewThreadInfo };

function logScopeShadowTelemetry(params: {
  logInfo: (message: string) => void;
  prNumber: number;
  lastReviewedSha: string | null;
  headSha: string;
  decision: string;
  reasonCode: string;
  scopedFilesBeforeIgnore: number;
  scopedFilesAfterIgnore: number;
  fullPrFilesAfterIgnore: number;
}): void {
  const {
    logInfo,
    prNumber,
    lastReviewedSha,
    headSha,
    decision,
    reasonCode,
    scopedFilesBeforeIgnore,
    scopedFilesAfterIgnore,
    fullPrFilesAfterIgnore,
  } = params;
  const wouldReviewFullPr = true;
  const fileDeltaVsAlwaysReview = fullPrFilesAfterIgnore - scopedFilesAfterIgnore;
  const mode = decision === REVIEW_SCOPE_DECISIONS.SKIP_CONFIDENT ? "skip" : "review";
  const hasLastReviewedSha = lastReviewedSha ? "true" : "false";
  logInfo(
    `[scope-shadow] pr=${prNumber} mode=${mode} decision=${decision} reason_code=${reasonCode} ` +
      `has_last_reviewed_sha=${hasLastReviewedSha} head_sha=${headSha} ` +
      `scoped_files_before_ignore=${scopedFilesBeforeIgnore} scoped_files_after_ignore=${scopedFilesAfterIgnore} ` +
      `always_review_full_pr=${wouldReviewFullPr} always_review_files_after_ignore=${fullPrFilesAfterIgnore} ` +
      `file_delta_vs_always_review=${fileDeltaVsAlwaysReview}`
  );
}

const LEARNED_PREFS_PATH = ".github/copilot-learned.json";

async function commitLearnedPrefs(
  octokit: ReturnType<typeof github.getOctokit>,
  context: ReviewContext,
  prefs: LearnedPrefs,
  logInfo: (message: string) => void
): Promise<void> {
  const content = JSON.stringify(prefs, null, 2);
  let existingSha: string | undefined;
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner: context.owner,
      repo: context.repo,
      path: LEARNED_PREFS_PATH,
    });
    if (!Array.isArray(data) && data.type === "file") {
      existingSha = data.sha;
      const existing = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8");
      if (existing === content) return;
    }
  } catch {
    // file doesn't exist yet — will create it
  }
  try {
    await octokit.rest.repos.createOrUpdateFileContents({
      owner: context.owner,
      repo: context.repo,
      path: LEARNED_PREFS_PATH,
      message: "chore: update learned review preferences [skip ci]",
      content: Buffer.from(content).toString("base64"),
      sha: existingSha,
    });
    logInfo("[learning] Committed updated preferences to .github/copilot-learned.json");
  } catch (err) {
    logInfo(`[learning] Failed to commit preferences: ${err}`);
  }
}
