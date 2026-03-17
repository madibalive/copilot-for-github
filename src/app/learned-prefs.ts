import fs from "node:fs";
import path from "node:path";
import type { LearnedPrefs, ReactionSummary } from "../types.js";

const PREFS_FILE = ".github/copilot-learned.json";
const DECAY_DAYS = 90;
const SIGNAL_THRESHOLD = 2; // |netScore| must be >= this to register

export function loadLearnedPrefs(repoRoot: string): LearnedPrefs | null {
  const filePath = path.join(repoRoot, PREFS_FILE);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1) return null;
    return parsed as LearnedPrefs;
  } catch {
    return null;
  }
}

/**
 * Merges fresh reaction signals into existing prefs.
 * - Reactions with |netScore| >= SIGNAL_THRESHOLD upsert into suppressions/amplifications.
 * - Entries older than DECAY_DAYS have their score moved 1 step toward zero.
 * - Entries whose score reaches 0 are removed.
 */
export function mergeReactionsIntoPrefs(
  existing: LearnedPrefs | null,
  reactions: ReactionSummary[]
): LearnedPrefs {
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = new Date(Date.now() - DECAY_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const suppressions = [...(existing?.suppressions ?? [])];
  const amplifications = [...(existing?.amplifications ?? [])];

  // Apply decay to stale entries before merging new signals
  for (const entry of suppressions) {
    if (entry.lastSeen < cutoff) entry.score += 1; // toward zero
  }
  for (const entry of amplifications) {
    if (entry.lastSeen < cutoff) entry.score -= 1; // toward zero
  }

  // Merge fresh reactions
  for (const r of reactions) {
    if (Math.abs(r.netScore) < SIGNAL_THRESHOLD) continue;
    const body = r.commentBody.replace(/<!--.*?-->/gs, "").trim();
    if (!body) continue;

    if (r.netScore <= -SIGNAL_THRESHOLD) {
      const existing_entry = suppressions.find((e) => e.pattern === body);
      if (existing_entry) {
        existing_entry.score += r.netScore;
        existing_entry.lastSeen = today;
      } else {
        suppressions.push({ pattern: body, score: r.netScore, lastSeen: today });
      }
    } else {
      const existing_entry = amplifications.find((e) => e.pattern === body);
      if (existing_entry) {
        existing_entry.score += r.netScore;
        existing_entry.lastSeen = today;
      } else {
        amplifications.push({ pattern: body, score: r.netScore, lastSeen: today });
      }
    }
  }

  return {
    version: 1,
    suppressions: suppressions.filter((e) => e.score < 0),
    amplifications: amplifications.filter((e) => e.score > 0),
    teamContext: existing?.teamContext ?? [],
  };
}

/**
 * Writes prefs to .github/copilot-learned.json.
 * Skips the write if content is unchanged (avoids unnecessary git diffs).
 */
export function saveLearnedPrefs(prefs: LearnedPrefs, repoRoot: string): void {
  const filePath = path.join(repoRoot, PREFS_FILE);
  const content = JSON.stringify(prefs, null, 2);

  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, "utf8");
    if (existing === content) return;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}
