import { test, expect } from "bun:test";
import { buildLearnedPrefsPrompt } from "../src/prompts/review.ts";
import type { LearnedPrefs } from "../src/types.ts";

// ── buildLearnedPrefsPrompt (TUS2.1 / TUS3.7) ────────────────────────────────

test("buildLearnedPrefsPrompt returns empty string for null prefs", () => {
  expect(buildLearnedPrefsPrompt(null)).toBe("");
});

test("buildLearnedPrefsPrompt returns empty string when all lists are empty", () => {
  const prefs: LearnedPrefs = { version: 1, suppressions: [], amplifications: [], teamContext: [] };
  expect(buildLearnedPrefsPrompt(prefs)).toBe("");
});

test("buildLearnedPrefsPrompt includes suppress entry for netScore <= -2", () => {
  const prefs: LearnedPrefs = {
    version: 1,
    suppressions: [{ pattern: "Missing semicolons flagged here", score: -3, lastSeen: "2026-03-01" }],
    amplifications: [],
    teamContext: [],
  };
  const result = buildLearnedPrefsPrompt(prefs);
  expect(result).toContain("SUPPRESS");
  expect(result).toContain("Missing semicolons flagged here");
});

test("buildLearnedPrefsPrompt includes amplify entry for netScore >= +2", () => {
  const prefs: LearnedPrefs = {
    version: 1,
    suppressions: [],
    amplifications: [{ pattern: "Error handling in async functions missing", score: 4, lastSeen: "2026-03-01" }],
    teamContext: [],
  };
  const result = buildLearnedPrefsPrompt(prefs);
  expect(result).toContain("AMPLIFY");
  expect(result).toContain("Error handling in async functions missing");
});

test("buildLearnedPrefsPrompt omits entry with score 0", () => {
  const prefs: LearnedPrefs = { version: 1, suppressions: [], amplifications: [], teamContext: [] };
  expect(buildLearnedPrefsPrompt(prefs)).toBe("");
});

test("buildLearnedPrefsPrompt handles both suppress and amplify in same call", () => {
  const prefs: LearnedPrefs = {
    version: 1,
    suppressions: [{ pattern: "Style nit about spacing", score: -2, lastSeen: "2026-03-01" }],
    amplifications: [{ pattern: "Auth token validation missing", score: 3, lastSeen: "2026-03-01" }],
    teamContext: [],
  };
  const result = buildLearnedPrefsPrompt(prefs);
  expect(result).toContain("SUPPRESS");
  expect(result).toContain("Style nit about spacing");
  expect(result).toContain("AMPLIFY");
  expect(result).toContain("Auth token validation missing");
});

test("buildLearnedPrefsPrompt includes section header", () => {
  const prefs: LearnedPrefs = {
    version: 1,
    suppressions: [],
    amplifications: [{ pattern: "Something the team liked", score: 5, lastSeen: "2026-03-01" }],
    teamContext: [],
  };
  expect(buildLearnedPrefsPrompt(prefs)).toContain("Learned Team Preferences");
});
