import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeProvider, parseReasoning, readConfig } from "../src/app/config.ts";

test("normalizeProvider maps common aliases", () => {
  expect(normalizeProvider("gemini")).toBe("google");
  expect(normalizeProvider("vertex")).toBe("google-vertex");
  expect(normalizeProvider("gpt")).toBe("openai");
  expect(normalizeProvider("anthropic")).toBe("anthropic");
});

test("parseReasoning accepts known levels", () => {
  expect(parseReasoning("off")).toBe("off");
  expect(parseReasoning("LOW")).toBe("low");
  expect(parseReasoning("xhigh")).toBe("xhigh");
});

test("readConfig merges .reviewerc defaults with action inputs", () => {
  const repoRoot = makeTempRepo();
  fs.writeFileSync(
    path.join(repoRoot, ".reviewerc"),
    [
      "version: 1",
      "review:",
      "  defaults:",
      "    provider: openrouter",
      "    model: anthropic/claude-sonnet-4",
      "    reasoning: medium",
      "    temperature: 0.4",
      "commands: []",
    ].join("\n"),
    "utf8"
  );

  const config = withEnv(
    {
      GITHUB_WORKSPACE: repoRoot,
      "INPUT_PROVIDER": "google",
      "INPUT_MODEL": "gemini-3-pro-preview",
      "INPUT_API-KEY": "test",
    },
    () => readConfig()
  );

  expect(config.review.provider).toBe("google");
  expect(config.review.modelId).toBe("gemini-3-pro-preview");
  expect(config.review.reasoning).toBe("medium");
  expect(config.review.temperature).toBe(0.4);
});

test("readConfig allows api-key for google-vertex", () => {
  const repoRoot = makeTempRepo();
  const config = withEnv(
    {
      GITHUB_WORKSPACE: repoRoot,
      "INPUT_PROVIDER": "google-vertex",
      "INPUT_MODEL": "gemini-2.5-flash",
      "INPUT_API-KEY": "vertex-key",
    },
    () => readConfig()
  );

  expect(config.review.provider).toBe("google-vertex");
  expect(config.review.apiKey).toBe("vertex-key");
});

test("readConfig does not require api-key for google-vertex", () => {
  const repoRoot = makeTempRepo();
  const config = withEnv(
    {
      GITHUB_WORKSPACE: repoRoot,
      "INPUT_PROVIDER": "google-vertex",
      "INPUT_MODEL": "gemini-2.5-flash",
    },
    () => readConfig()
  );

  expect(config.review.provider).toBe("google-vertex");
  expect(config.review.apiKey).toBe("");
});

test("readConfig enables PR tools when allow-pr-tools input is true", () => {
  const repoRoot = makeTempRepo();
  const config = withEnv(
    {
      GITHUB_WORKSPACE: repoRoot,
      "INPUT_PROVIDER": "google",
      "INPUT_MODEL": "gemini-3-pro-preview",
      "INPUT_API-KEY": "test",
      "INPUT_ALLOW-PR-TOOLS": "true",
    },
    () => readConfig()
  );

  expect(config.review.allowPrToolsInReview).toBe(true);
});

test("readConfig enables experimental PR explainer when input is true", () => {
  const repoRoot = makeTempRepo();
  const config = withEnv(
    {
      GITHUB_WORKSPACE: repoRoot,
      "INPUT_PROVIDER": "google",
      "INPUT_MODEL": "gemini-3-pro-preview",
      "INPUT_API-KEY": "test",
      "INPUT_EXPERIMENTAL-PR-EXPLAINER": "true",
    },
    () => readConfig()
  );

  expect(config.review.experimentalPrExplainer).toBe(true);
});

test("readConfig enables experimental PR explainer from .reviewerc", () => {
  const repoRoot = makeTempRepo();
  fs.writeFileSync(
    path.join(repoRoot, ".reviewerc"),
    [
      "version: 1",
      "review:",
      "  experimental:",
      "    prExplainer: true",
    ].join("\n"),
    "utf8"
  );

  const config = withEnv(
    {
      GITHUB_WORKSPACE: repoRoot,
      "INPUT_PROVIDER": "google",
      "INPUT_MODEL": "gemini-3-pro-preview",
      "INPUT_API-KEY": "test",
    },
    () => readConfig()
  );

  expect(config.review.experimentalPrExplainer).toBe(true);
});

test("readConfig rejects invalid YAML", () => {
  const repoRoot = makeTempRepo();
  fs.writeFileSync(path.join(repoRoot, ".reviewerc"), "version: [", "utf8");

  const error = withEnv(
    {
      GITHUB_WORKSPACE: repoRoot,
      "INPUT_PROVIDER": "google",
      "INPUT_MODEL": "gemini-3-pro-preview",
      "INPUT_API-KEY": "test",
    },
    () => {
      try {
        readConfig();
      } catch (err: any) {
        return err;
      }
      return null;
    }
  );

  expect(error).not.toBeNull();
  expect(String(error?.message)).toContain("Invalid YAML");
});

test("readConfig rejects schema violations", () => {
  const repoRoot = makeTempRepo();
  fs.writeFileSync(path.join(repoRoot, ".reviewerc"), "review: {}", "utf8");

  const error = withEnv(
    {
      GITHUB_WORKSPACE: repoRoot,
      "INPUT_PROVIDER": "google",
      "INPUT_MODEL": "gemini-3-pro-preview",
      "INPUT_API-KEY": "test",
    },
    () => {
      try {
        readConfig();
      } catch (err: any) {
        return err;
      }
      return null;
    }
  );

  expect(error).not.toBeNull();
  expect(String(error?.message)).toContain("Invalid .reviewerc");
});

test("readConfig rejects removed keys", () => {
  const repoRoot = makeTempRepo();
  fs.writeFileSync(
    path.join(repoRoot, ".reviewerc"),
    [
      "version: 1",
      "schedule:",
      "  output:",
      "    type: pr",
    ].join("\n"),
    "utf8"
  );

  const error = withEnv(
    {
      GITHUB_WORKSPACE: repoRoot,
      "INPUT_PROVIDER": "google",
      "INPUT_MODEL": "gemini-3-pro-preview",
      "INPUT_API-KEY": "test",
    },
    () => {
      try {
        readConfig();
      } catch (err: any) {
        return err;
      }
      return null;
    }
  );

  expect(error).not.toBeNull();
  expect(String(error?.message)).toContain("schedule.output");
});

test("readConfig uses maxFiles from .reviewerc defaults when action input absent", () => {
  const repoRoot = makeTempRepo();
  fs.writeFileSync(
    path.join(repoRoot, ".reviewerc"),
    ["version: 1", "review:", "  defaults:", "    provider: openrouter", "    model: claude-sonnet-4", "    maxFiles: 25"].join("\n"),
    "utf8"
  );
  const config = withEnv(
    { GITHUB_WORKSPACE: repoRoot, "INPUT_API-KEY": "test" },
    () => readConfig()
  );
  expect(config.review.maxFiles).toBe(25);
});

test("readConfig action input max-files overrides .reviewerc maxFiles", () => {
  const repoRoot = makeTempRepo();
  fs.writeFileSync(
    path.join(repoRoot, ".reviewerc"),
    ["version: 1", "review:", "  defaults:", "    provider: openrouter", "    model: claude-sonnet-4", "    maxFiles: 25"].join("\n"),
    "utf8"
  );
  const config = withEnv(
    { GITHUB_WORKSPACE: repoRoot, "INPUT_API-KEY": "test", "INPUT_MAX-FILES": "10" },
    () => readConfig()
  );
  expect(config.review.maxFiles).toBe(10);
});

// --- exclude-bots ---

test("readConfig excludes known bots by default when no author filters set", () => {
  const repoRoot = makeTempRepo();
  const config = withEnv(
    {
      GITHUB_WORKSPACE: repoRoot,
      "INPUT_PROVIDER": "google",
      "INPUT_MODEL": "gemini-3-pro-preview",
      "INPUT_API-KEY": "test",
    },
    () => readConfig()
  );
  expect(config.authorFilters?.exclude).toContain("dependabot[bot]");
  expect(config.authorFilters?.exclude).toContain("renovate[bot]");
  expect(config.authorFilters?.exclude).toContain("github-actions[bot]");
  expect(config.authorFilters?.include).toBeUndefined();
});

test("readConfig merges known bots with explicit exclude-authors", () => {
  const repoRoot = makeTempRepo();
  const config = withEnv(
    {
      GITHUB_WORKSPACE: repoRoot,
      "INPUT_PROVIDER": "google",
      "INPUT_MODEL": "gemini-3-pro-preview",
      "INPUT_API-KEY": "test",
      "INPUT_EXCLUDE-AUTHORS": "mybot",
    },
    () => readConfig()
  );
  expect(config.authorFilters?.exclude).toContain("mybot");
  expect(config.authorFilters?.exclude).toContain("dependabot[bot]");
});

test("readConfig exclude-bots: false disables default bot exclusion", () => {
  const repoRoot = makeTempRepo();
  const config = withEnv(
    {
      GITHUB_WORKSPACE: repoRoot,
      "INPUT_PROVIDER": "google",
      "INPUT_MODEL": "gemini-3-pro-preview",
      "INPUT_API-KEY": "test",
      "INPUT_EXCLUDE-BOTS": "false",
    },
    () => readConfig()
  );
  expect(config.authorFilters?.exclude ?? []).not.toContain("dependabot[bot]");
});

test("readConfig excludeBots: false in .reviewerc disables default bot exclusion", () => {
  const repoRoot = makeTempRepo();
  fs.writeFileSync(
    path.join(repoRoot, ".reviewerc"),
    [
      "version: 1",
      "review:",
      "  defaults:",
      "    provider: openrouter",
      "    model: claude-sonnet-4",
      "    excludeBots: false",
    ].join("\n"),
    "utf8"
  );
  const config = withEnv(
    { GITHUB_WORKSPACE: repoRoot, "INPUT_API-KEY": "test" },
    () => readConfig()
  );
  expect(config.authorFilters?.exclude ?? []).not.toContain("dependabot[bot]");
});

test("readConfig skips bot merge when include-authors is explicitly set", () => {
  const repoRoot = makeTempRepo();
  const config = withEnv(
    {
      GITHUB_WORKSPACE: repoRoot,
      "INPUT_PROVIDER": "google",
      "INPUT_MODEL": "gemini-3-pro-preview",
      "INPUT_API-KEY": "test",
      "INPUT_INCLUDE-AUTHORS": "alice,bob",
    },
    () => readConfig()
  );
  // include list is set — bots not in include are already blocked; no exclude merge
  expect(config.authorFilters?.include).toEqual(["alice", "bob"]);
  expect(config.authorFilters?.exclude ?? []).not.toContain("dependabot[bot]");
});

// ── learning config (TUS3.2) ─────────────────────────────────────────────────

test("readConfig defaults learning to true when not set", () => {
  const repoRoot = makeTempRepo();
  const config = withEnv(
    { GITHUB_WORKSPACE: repoRoot, "INPUT_PROVIDER": "anthropic", "INPUT_MODEL": "claude-sonnet-4", "INPUT_API-KEY": "test" },
    () => readConfig()
  );
  expect(config.learning).toBe(true);
});

test("readConfig sets learning to false from action input", () => {
  const repoRoot = makeTempRepo();
  const config = withEnv(
    {
      GITHUB_WORKSPACE: repoRoot,
      "INPUT_PROVIDER": "anthropic",
      "INPUT_MODEL": "claude-sonnet-4",
      "INPUT_API-KEY": "test",
      "INPUT_LEARNING": "false",
    },
    () => readConfig()
  );
  expect(config.learning).toBe(false);
});

test("readConfig reads learning from .reviewerc defaults", () => {
  const repoRoot = makeTempRepo();
  fs.writeFileSync(
    path.join(repoRoot, ".reviewerc"),
    ["version: 1", "review:", "  defaults:", "    provider: anthropic", "    model: claude-sonnet-4", "    learning: false"].join("\n"),
    "utf8"
  );
  const config = withEnv(
    { GITHUB_WORKSPACE: repoRoot, "INPUT_API-KEY": "test" },
    () => readConfig()
  );
  expect(config.learning).toBe(false);
});

test("readConfig action input learning overrides .reviewerc", () => {
  const repoRoot = makeTempRepo();
  fs.writeFileSync(
    path.join(repoRoot, ".reviewerc"),
    ["version: 1", "review:", "  defaults:", "    provider: anthropic", "    model: claude-sonnet-4", "    learning: false"].join("\n"),
    "utf8"
  );
  const config = withEnv(
    {
      GITHUB_WORKSPACE: repoRoot,
      "INPUT_API-KEY": "test",
      "INPUT_LEARNING": "true",
    },
    () => readConfig()
  );
  expect(config.learning).toBe(true);
});

// ── dora config (TUS4.2) ─────────────────────────────────────────────────────

test("readConfig defaults dora.enabled to false when not set", () => {
  const repoRoot = makeTempRepo();
  const config = withEnv(
    { GITHUB_WORKSPACE: repoRoot, "INPUT_PROVIDER": "anthropic", "INPUT_MODEL": "claude-sonnet-4", "INPUT_API-KEY": "test" },
    () => readConfig()
  );
  expect(config.review.dora?.enabled ?? false).toBe(false);
});

test("readConfig sets dora.enabled to true from use-dora action input", () => {
  const repoRoot = makeTempRepo();
  const config = withEnv(
    {
      GITHUB_WORKSPACE: repoRoot,
      "INPUT_PROVIDER": "anthropic",
      "INPUT_MODEL": "claude-sonnet-4",
      "INPUT_API-KEY": "test",
      "INPUT_USE-DORA": "true",
    },
    () => readConfig()
  );
  expect(config.review.dora?.enabled).toBe(true);
});

test("readConfig reads dora.enabled from .reviewerc defaults", () => {
  const repoRoot = makeTempRepo();
  fs.writeFileSync(
    path.join(repoRoot, ".reviewerc"),
    ["version: 1", "review:", "  defaults:", "    provider: anthropic", "    model: claude-sonnet-4", "    dora:", "      enabled: true"].join("\n"),
    "utf8"
  );
  const config = withEnv(
    { GITHUB_WORKSPACE: repoRoot, "INPUT_API-KEY": "test" },
    () => readConfig()
  );
  expect(config.review.dora?.enabled).toBe(true);
});

function makeTempRepo(): string {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sra-config-"));
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  return repoRoot;
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
