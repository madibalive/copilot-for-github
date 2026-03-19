import * as core from "@actions/core";
import fs from "node:fs";
import path from "node:path";
import { readReviewerc } from "./reviewerc.js";
import { KNOWN_BOTS } from "./pr-filters.js";
import type { ActionConfig, CommentType, ReviewConfig, ToolCategory } from "../types.js";

const DEFAULT_IGNORE_PATTERNS = "*.lock,*.generated.*";
const DEFAULT_MAX_FILES = 50;
const DEFAULT_COMMENT_TYPE: CommentType = "both";
const DEFAULT_TOOLS_ALLOWLIST: ToolCategory[] = [
  "agent.subagent",
  "filesystem",
  "git.read",
  "git.history",
  "github.pr.read",
  "github.pr.feedback",
  "github.pr.manage",
  "repo.write",
];

function getOptionalInput(name: string): string | undefined {
  const raw = core.getInput(name);
  const trimmed = raw?.trim() ?? "";
  return trimmed ? trimmed : undefined;
}

export function readConfig(): ActionConfig {
  const repoRoot = process.env.GITHUB_WORKSPACE || process.cwd();
  const gitDir = path.join(repoRoot, ".git");
  if (!fs.existsSync(gitDir)) {
    throw new Error("Checkout missing. Ensure actions/checkout ran before this action.");
  }

  const reviewerc = readReviewerc(repoRoot);
  const reviewDefaults = reviewerc?.review?.defaults ?? {};

  const providerInput = getOptionalInput("provider");
  const modelInput = getOptionalInput("model");
  const apiKeyInput = getOptionalInput("api-key") ?? "";
  const compactionModelInput = getOptionalInput("compaction-model");
  const maxFilesInput = getOptionalInput("max-files");
  const ignorePatternsInput = getOptionalInput("ignore-patterns");
  const debugInput = getOptionalInput("debug");
  const reasoningInput = getOptionalInput("reasoning");
  const temperatureInput = getOptionalInput("temperature");
  const botNameInput = getOptionalInput("bot-name");
  const skipAutomaticInput = getOptionalInput("skip-automatic");
  const triggerOnUpdatesInput = getOptionalInput("trigger-on-updates");
  const excludeBotsInput = getOptionalInput("exclude-bots");
  const includeAuthorsInput = getOptionalInput("include-authors");
  const excludeAuthorsInput = getOptionalInput("exclude-authors");
  const skipKeywordsInput = getOptionalInput("skip-keywords");
  const includeKeywordsInput = getOptionalInput("include-keywords");
  const includeBaseBranchesInput = getOptionalInput("include-base-branches");
  const excludeBaseBranchesInput = getOptionalInput("exclude-base-branches");
  const includeHeadBranchesInput = getOptionalInput("include-head-branches");
  const excludeHeadBranchesInput = getOptionalInput("exclude-head-branches");
  const includeLabelsInput = getOptionalInput("include-labels");
  const excludeLabelsInput = getOptionalInput("exclude-labels");
  const allowPrToolsInput = getOptionalInput("allow-pr-tools");
  const experimentalPrExplainerInput = getOptionalInput("experimental-pr-explainer");
  const learningInput = getOptionalInput("learning");
  const useDoraInput = getOptionalInput("use-dora");
  const doraVersionInput = getOptionalInput("dora-version");
  const doraPreIndexInput = getOptionalInput("dora-pre-index");
  const contextFileInput = getOptionalInput("context-file");

  const providerRaw = providerInput ?? reviewDefaults.provider ?? "";
  if (!providerRaw) {
    throw new Error("Missing provider. Set action input provider or review.defaults.provider in .reviewerc.");
  }
  const provider = normalizeProvider(providerRaw);

  const modelId = modelInput ?? reviewDefaults.model ?? "";
  if (!modelId) {
    throw new Error("Missing model. Set action input model or review.defaults.model in .reviewerc.");
  }

  const maxFilesRaw = maxFilesInput ?? (reviewDefaults.maxFiles !== undefined ? String(reviewDefaults.maxFiles) : String(DEFAULT_MAX_FILES));
  const maxFiles = Number.parseInt(maxFilesRaw, 10);
  if (!Number.isFinite(maxFiles) || maxFiles <= 0) {
    throw new Error(`Invalid max-files: ${maxFilesRaw}`);
  }

  const ignorePatternsRaw = ignorePatternsInput ?? DEFAULT_IGNORE_PATTERNS;
  const ignorePatterns = ignorePatternsRaw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const debug = debugInput ? debugInput.toLowerCase() === "true" : false;
  const reasoningValue = reasoningInput ?? reviewDefaults.reasoning ?? "off";
  const reasoning = parseReasoning(reasoningValue);

  const temperatureRaw = temperatureInput ?? (reviewDefaults.temperature !== undefined ? String(reviewDefaults.temperature) : "");
  const temperature = temperatureRaw ? Number.parseFloat(temperatureRaw) : undefined;
  if (temperature !== undefined && (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)) {
    throw new Error(`Invalid temperature: ${temperatureRaw}`);
  }

  const allowPrTools =
    allowPrToolsInput !== undefined
      ? allowPrToolsInput.toLowerCase() === "true"
      : reviewerc?.review?.allowPrToolsInReview ?? false;
  const experimentalPrExplainer =
    experimentalPrExplainerInput !== undefined
      ? experimentalPrExplainerInput.toLowerCase() === "true"
      : reviewerc?.review?.experimental?.prExplainer ?? false;
  const hashlinesEnabled = reviewerc?.review?.experimental?.hashlinesEnabled ?? false;

  if (!apiKeyInput && provider !== "google-vertex") {
    throw new Error("api-key is required for non-Vertex providers. For Vertex AI, api-key is optional (ADC or key).");
  }

  const doraEnabled =
    useDoraInput !== undefined
      ? useDoraInput.toLowerCase() === "true"
      : reviewDefaults.dora?.enabled ?? false;
  const dora = doraEnabled
    ? {
        enabled: true,
        version: doraVersionInput ?? reviewDefaults.dora?.version,
        preIndex: doraPreIndexInput ?? reviewDefaults.dora?.preIndex,
      }
    : undefined;

  const review: ReviewConfig = {
    provider,
    apiKey: apiKeyInput ?? "",
    modelId,
    compactionModel: compactionModelInput ? compactionModelInput.trim() : undefined,
    maxFiles,
    ignorePatterns,
    repoRoot,
    debug,
    reasoning,
    temperature,
    allowPrToolsInReview: allowPrTools,
    experimentalPrExplainer,
    hashlinesEnabled,
    dora,
    contextFile: contextFileInput ?? reviewDefaults.contextFile,
  };

  const skipAutomatic = skipAutomaticInput !== undefined
    ? skipAutomaticInput.toLowerCase() === "true"
    : reviewDefaults.skipAutomatic ?? false;

  const triggerOnUpdates = triggerOnUpdatesInput !== undefined
    ? triggerOnUpdatesInput.toLowerCase() === "true"
    : reviewDefaults.triggerOnUpdates ?? true;

  function splitList(input: string | undefined): string[] | undefined {
    const items = input?.split(",").map((s) => s.trim()).filter(Boolean);
    return items?.length ? items : undefined;
  }

  const excludeBots = excludeBotsInput !== undefined
    ? excludeBotsInput.toLowerCase() !== "false"
    : reviewDefaults.excludeBots ?? true;

  const includeAuthors = splitList(includeAuthorsInput);
  const excludeAuthors = splitList(excludeAuthorsInput);
  let authorFilters: { include?: string[]; exclude?: string[] } | undefined = (includeAuthors || excludeAuthors)
    ? { include: includeAuthors, exclude: excludeAuthors }
    : reviewerc?.review?.authorFilters;

  if (excludeBots && !authorFilters?.include?.length) {
    const existing = authorFilters ?? {};
    authorFilters = { ...existing, exclude: [...new Set([...(existing.exclude ?? []), ...KNOWN_BOTS])] };
  }

  const skipKeywords = splitList(skipKeywordsInput);
  const includeKeywords = splitList(includeKeywordsInput);
  const keywordFilters = (skipKeywords || includeKeywords)
    ? { skipKeywords, includeKeywords }
    : reviewerc?.review?.keywordFilters;

  const includeBaseBranches = splitList(includeBaseBranchesInput);
  const excludeBaseBranches = splitList(excludeBaseBranchesInput);
  const baseBranchFilters = (includeBaseBranches || excludeBaseBranches)
    ? { include: includeBaseBranches, exclude: excludeBaseBranches }
    : reviewerc?.review?.baseBranchFilters;

  const includeHeadBranches = splitList(includeHeadBranchesInput);
  const excludeHeadBranches = splitList(excludeHeadBranchesInput);
  const headBranchFilters = (includeHeadBranches || excludeHeadBranches)
    ? { include: includeHeadBranches, exclude: excludeHeadBranches }
    : reviewerc?.review?.headBranchFilters;

  const includeLabels = splitList(includeLabelsInput);
  const excludeLabels = splitList(excludeLabelsInput);
  const labelFilters = (includeLabels || excludeLabels)
    ? { include: includeLabels, exclude: excludeLabels }
    : reviewerc?.review?.labelFilters;

  return {
    review,
    reviewRun: reviewerc?.review?.run ?? [],
    commands: reviewerc?.commands ?? [],
    schedule: reviewerc?.schedule,
    toolsAllowlist: reviewerc?.tools?.allowlist ?? DEFAULT_TOOLS_ALLOWLIST,
    outputCommentType: reviewerc?.output?.commentType ?? DEFAULT_COMMENT_TYPE,
    botName: botNameInput,
    skipAutomatic,
    triggerOnUpdates,
    authorFilters,
    keywordFilters,
    baseBranchFilters,
    headBranchFilters,
    labelFilters,
    learning: learningInput !== undefined
      ? learningInput.toLowerCase() !== "false"
      : reviewDefaults.learning ?? true,
  };
}

export function parseReasoning(value: string): ReviewConfig["reasoning"] {
  switch (value.toLowerCase()) {
    case "off":
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return value.toLowerCase() as ReviewConfig["reasoning"];
    default:
      throw new Error(`Invalid reasoning level: ${value}`);
  }
}

export function normalizeProvider(value: string): string {
  const lowered = value.trim().toLowerCase();
  const aliases: Record<string, string> = {
    gemini: "google",
    vertex: "google-vertex",
    vertexai: "google-vertex",
    "vertex-ai": "google-vertex",
    claude: "anthropic",
    gpt: "openai",
    chatgpt: "openai",
  };
  return aliases[lowered] ?? value.trim();
}
