import { test, expect, mock, spyOn } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadLearnedPrefs, mergeReactionsIntoPrefs, saveLearnedPrefs } from "../src/app/learned-prefs.ts";
import type { ReactionSummary, LearnedPrefs } from "../src/types.ts";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "copilot-test-"));
}

const PREFS_PATH = ".github/copilot-learned.json";

// ── loadLearnedPrefs ─────────────────────────────────────────────────────────

test("loadLearnedPrefs returns null when file does not exist", () => {
  const dir = tmpDir();
  expect(loadLearnedPrefs(dir)).toBeNull();
});

test("loadLearnedPrefs returns null on corrupt JSON (no throw)", () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, ".github"), { recursive: true });
  fs.writeFileSync(path.join(dir, PREFS_PATH), "{ not valid json", "utf8");
  expect(loadLearnedPrefs(dir)).toBeNull();
});

test("loadLearnedPrefs returns null on wrong schema version", () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, ".github"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, PREFS_PATH),
    JSON.stringify({ version: 2, suppressions: [], amplifications: [], teamContext: [] }),
    "utf8"
  );
  expect(loadLearnedPrefs(dir)).toBeNull();
});

test("loadLearnedPrefs returns parsed prefs for valid file", () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, ".github"), { recursive: true });
  const prefs: LearnedPrefs = {
    version: 1,
    suppressions: [{ pattern: "style nit", score: -3, lastSeen: "2026-03-01" }],
    amplifications: [],
    teamContext: [],
  };
  fs.writeFileSync(path.join(dir, PREFS_PATH), JSON.stringify(prefs), "utf8");
  const loaded = loadLearnedPrefs(dir);
  expect(loaded).not.toBeNull();
  expect(loaded!.suppressions[0].pattern).toBe("style nit");
});

// ── mergeReactionsIntoPrefs ──────────────────────────────────────────────────

test("mergeReactionsIntoPrefs creates suppression for net negative reaction on null existing", () => {
  const reactions: ReactionSummary[] = [
    { commentId: 1, commentBody: "Semicolon nit", thumbsUp: 0, thumbsDown: 3, netScore: -3 },
  ];
  const result = mergeReactionsIntoPrefs(null, reactions);
  expect(result.suppressions).toHaveLength(1);
  expect(result.suppressions[0].pattern).toContain("Semicolon nit");
  expect(result.suppressions[0].score).toBeLessThan(0);
});

test("mergeReactionsIntoPrefs creates amplification for net positive reaction on null existing", () => {
  const reactions: ReactionSummary[] = [
    { commentId: 2, commentBody: "Error handling missing", thumbsUp: 4, thumbsDown: 0, netScore: 4 },
  ];
  const result = mergeReactionsIntoPrefs(null, reactions);
  expect(result.amplifications).toHaveLength(1);
  expect(result.amplifications[0].score).toBeGreaterThan(0);
});

test("mergeReactionsIntoPrefs accumulates score on repeated reactions for same pattern", () => {
  const existing: LearnedPrefs = {
    version: 1,
    suppressions: [{ pattern: "style nit", score: -2, lastSeen: "2026-02-01" }],
    amplifications: [],
    teamContext: [],
  };
  const reactions: ReactionSummary[] = [
    { commentId: 1, commentBody: "style nit", thumbsUp: 0, thumbsDown: 2, netScore: -2 },
  ];
  const result = mergeReactionsIntoPrefs(existing, reactions);
  expect(result.suppressions[0].score).toBeLessThan(-2);
});

test("mergeReactionsIntoPrefs ignores neutral reactions (|netScore| < 2)", () => {
  const reactions: ReactionSummary[] = [
    { commentId: 3, commentBody: "Neutral comment", thumbsUp: 1, thumbsDown: 1, netScore: 0 },
    { commentId: 4, commentBody: "Slight thumbs up", thumbsUp: 1, thumbsDown: 0, netScore: 1 },
  ];
  const result = mergeReactionsIntoPrefs(null, reactions);
  expect(result.suppressions).toHaveLength(0);
  expect(result.amplifications).toHaveLength(0);
});

test("mergeReactionsIntoPrefs decays scores older than 90 days by 1", () => {
  const ninetyOneDaysAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const existing: LearnedPrefs = {
    version: 1,
    suppressions: [{ pattern: "old style nit", score: -3, lastSeen: ninetyOneDaysAgo }],
    amplifications: [],
    teamContext: [],
  };
  const result = mergeReactionsIntoPrefs(existing, []);
  expect(result.suppressions[0].score).toBe(-2);
});

test("mergeReactionsIntoPrefs removes entries that decay to zero", () => {
  const ninetyOneDaysAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const existing: LearnedPrefs = {
    version: 1,
    suppressions: [{ pattern: "barely suppressed", score: -1, lastSeen: ninetyOneDaysAgo }],
    amplifications: [{ pattern: "barely amplified", score: 1, lastSeen: ninetyOneDaysAgo }],
    teamContext: [],
  };
  const result = mergeReactionsIntoPrefs(existing, []);
  expect(result.suppressions).toHaveLength(0);
  expect(result.amplifications).toHaveLength(0);
});

test("mergeReactionsIntoPrefs sets version: 1 on result", () => {
  const result = mergeReactionsIntoPrefs(null, []);
  expect(result.version).toBe(1);
});

// ── saveLearnedPrefs ─────────────────────────────────────────────────────────

test("saveLearnedPrefs writes file to .github/copilot-learned.json", () => {
  const dir = tmpDir();
  const prefs: LearnedPrefs = {
    version: 1,
    suppressions: [],
    amplifications: [{ pattern: "auth check", score: 3, lastSeen: "2026-03-15" }],
    teamContext: [],
  };
  saveLearnedPrefs(prefs, dir);
  const written = JSON.parse(fs.readFileSync(path.join(dir, PREFS_PATH), "utf8"));
  expect(written.amplifications[0].pattern).toBe("auth check");
});

test("saveLearnedPrefs creates .github directory if missing", () => {
  const dir = tmpDir();
  const prefs: LearnedPrefs = { version: 1, suppressions: [], amplifications: [], teamContext: [] };
  saveLearnedPrefs(prefs, dir);
  expect(fs.existsSync(path.join(dir, PREFS_PATH))).toBe(true);
});

test("saveLearnedPrefs does not write when content is unchanged", () => {
  const dir = tmpDir();
  const prefs: LearnedPrefs = { version: 1, suppressions: [], amplifications: [], teamContext: [] };
  saveLearnedPrefs(prefs, dir);

  const writeSpy = spyOn(fs, "writeFileSync");
  saveLearnedPrefs(prefs, dir); // second call — same content
  expect(writeSpy).not.toHaveBeenCalled();
  writeSpy.mockRestore();
});
