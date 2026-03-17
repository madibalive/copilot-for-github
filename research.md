# Research: Learning/Memory System & Cross-File Intelligence

> Phase 0 research consolidating findings from Greptile docs, pi-action-runner, dora, click, pi-memory, and pi-kysely.

---

## 1. Greptile's Memory & Learning System

### What they store persistently

PostgreSQL + pgvector (embeddings). Key tables:
- Repository metadata and summaries
- Code embeddings for semantic search
- **Per-comment-type metrics** (made, addressed, reactions, ignored)
- Custom rules authored via dashboard
- Team reaction history

### Learning signals

Only 👍 and 👎 train the system. Other reactions are neutral.

```
Comment Made → Team reacts?
  👍 = positive signal, keep making this type of comment
  👎 = negative signal, track ignore count
  No reaction = neutral (lower weight over time)

Suppression threshold: ignored 3+ times → suppress comment type
  EXCEPTION: security vulns, memory leaks, null pointer exceptions are never suppressed
```

Context from replies matters: `@greptileai We avoid wildcard imports because they hide dependencies` is stored alongside the reaction.

### Per-comment-type metrics structure

```typescript
const learningData = {
  semicolonComments: { made: 10, addressed: 0, reactions: -3 },
  securityComments: { made: 5, addressed: 5, reactions: +4 },
};
```

### Auto-rule discovery timeline

- Week 1–4: generic suggestions, baseline data collection
- Week 5–8: custom patterns emerge from PR comment analysis
- Week 9+: personalized, suppressed noise

After ~10 PRs, Greptile suggests rules based on observed patterns.

### Config file structure (`.greptile/config.json`)

```json
{
  "strictness": 1,
  "rules": [
    { "id": "uid", "rule": "...", "scope": ["src/db/**"], "severity": "high", "enabled": true }
  ],
  "disabledRules": ["uid-to-disable"],
  "customContext": { "rules": [], "files": [], "other": [] }
}
```

Cascading config: walks from repo root to file directory, child overrides parent settings, child+parent rules combine.

---

## 2. dora — SCIP-based Code Intelligence

**Decision: High-value integration for cross-file analysis gap.**

**Rationale:** dora converts a SCIP index into a queryable SQLite database. It turns call-graph questions from "grep across hundreds of files" into millisecond queries. The pi-action-runner already uses it — proving viability as a GitHub Action component.

**Alternatives considered:** Tree-sitter alone (no cross-file), LSP in CI (complex setup), sourcegraph (SaaS-only).

### What dora provides

```bash
dora symbol AuthService       # find symbols by name
dora refs validateToken       # all references across codebase
dora deps src/auth/service.ts --depth 2   # what this file imports
dora rdeps src/auth/service.ts            # what imports this file
dora cycles                              # circular dependency detection
dora coupling --threshold 5             # high symbol-sharing file pairs
dora adventure src/a.ts src/b.ts        # shortest path between files
dora smells src/auth/service.ts         # complexity, long functions, TODOs
```

### Integration path

1. Add dora install + `dora init && dora index` to the GitHub Action workflow (cached by commit SHA — free on warm runs)
2. Expose dora CLI as a bash tool in the agent (or wrap as structured tools)
3. Agent can now answer: "what calls this function?", "what breaks if I change this interface?"

**Caching strategy from pi-action-runner:**
```yaml
- cache key: dora version + scip install command  → dora binary
- cache key: commit SHA                           → .dora/ index (busted each commit)
```

---

## 3. click — SQLite Memory for pi Agents

**Decision: Best reference for the learning/memory data model.**

**Rationale:** click is purpose-built for persisting AI agent memories across sessions with FTS5 search and scope-aware injection. Its schema maps directly to what we need. It uses Node's built-in `node:sqlite` (no external dep) + WAL mode.

### Schema (verbatim)

```sql
CREATE TABLE memories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  scope      TEXT NOT NULL DEFAULT 'project',  -- 'project' | 'user'
  project    TEXT,                              -- cwd for project-scoped
  category   TEXT NOT NULL,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  tags       TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE memories_fts USING fts5(title, content, tags, content=memories);
```

### Categories applicable to PR review learning

| Category | Use for |
|---|---|
| `convention` | Team coding standards learned from reactions |
| `preference` | Comment types the team wants suppressed or amplified |
| `pattern` | Recurring anti-patterns the team cares about |
| `lesson` | Notes from 👎 reactions with developer explanations |
| `decision` | Architectural choices (avoid flagging X, always flag Y) |

### Auto-injection model

Before each agent turn:
1. Load all `overview` memories (always present)
2. FTS5 search memories relevant to current prompt
3. Inject as `# Recalled Memories` context block, capped ~4KB

---

## 4. pi-memory — Markdown-based Memory

**Decision: Skip in favor of click's structured SQLite.**

**Rationale:** pi-memory stores MEMORY.md + daily logs as plain Markdown. Good for human-readable notes, but FTS5 + structured queries are better for automated learning. The injection mechanism (MEMORY.md into every turn) is a useful pattern.

**How to apply:** Borrow the `MEMORY.md`-in-every-turn injection pattern, but back it with SQLite instead of files.

---

## 5. pi-kysely — Shared Database for pi Extensions

**Decision: Skip for initial implementation, revisit if multi-extension needed.**

**Rationale:** pi-kysely is a shared Kysely (SQLite/Postgres/MySQL) registry for pi extensions communicating via an event bus. The RBAC model (`extension__tablename` prefixes) is elegant but adds ceremony. For our use case, a single SQLite file owned by the copilot action is simpler.

**Alternatives considered:** Turso (libSQL at the edge, works in Actions), Neon (serverless Postgres), Supabase.

---

## 6. pi-action-runner — GitHub Action Reference Implementation

**Decision: Study architecture, selectively adopt patterns.**

**Rationale:** pi-action-runner is the closest existing implementation to what copilot-for-github does. It runs a pi agent on GitHub events, supports dora code intelligence, and handles PR review + inline comments + issue/discussion responses.

### Key differences from copilot-for-github

| Feature | pi-action-runner | copilot-for-github |
|---|---|---|
| Review trigger | `@pi review` mention only | Automatic on PR open + configurable |
| Code intelligence | dora (SCIP graph) | File reads + git diff only |
| Memory | None | None (yet) |
| Config | action.yml inputs only | `.reviewerc` with rich schema |
| Filters | None | Author/label/branch/keyword filters |
| Incremental reviews | No | Yes (SHA tracking) |
| Custom rules | Via system_prompt file | `.reviewerc` commands |

### Dora skill integration pattern

```typescript
// pi-action-runner/src/agent.ts
const doraSkill = loadDoraSkill({ workingDir });
// skill = markdown instructions injected into system prompt
// agent calls dora CLI as bash commands
```

---

## 7. The Core Problem: Stateless GitHub Actions

The fundamental constraint: **GitHub Actions have no persistent process**. Every run is a fresh container. All persistence must be external.

### Storage options evaluated

| Option | Pros | Cons |
|---|---|---|
| **GitHub comment markers** (current) | Zero infra, already used for SHA tracking | Text-only, no querying |
| **File committed to repo** (`LEARNED_RULES.md`) | Auditable, versionable, no external deps | Pollutes git history with bot commits |
| **Dedicated git branch** (`refs/bot-data`) | Clean, no main branch clutter | Complex git ops in CI |
| **GitHub Gist** (private) | Simple API, persistent, free | Single user's account, not repo-scoped |
| **GitHub Actions cache** | Fast, built-in | Ephemeral (7-day TTL), no guarantee |
| **SQLite in repo** | Structured queries | Binary in git is terrible |
| **External DB (Turso/Neon/Supabase)** | Full SQL, proper persistence | Requires user to provision and manage credentials |
| **GitHub Releases/Artifacts** | Persistent, API accessible | Not designed for this, awkward |

**Recommended decision: File committed to repo** for rules/preferences, **GitHub API reactions** as the learning signal.

**Why:**
- Reactions (👍/👎) on bot comments are already available via GitHub API — zero extra infrastructure
- A committed file (e.g., `.reviewerc-learned.json` or a section in `.reviewerc`) is auditable and team-editable
- No external credentials required — works with `GITHUB_TOKEN`

---

## 8. Proposed Architecture: Lightweight Learning System

### Learning signal: GitHub reactions on bot comments

```typescript
// Fetch reactions on the bot's previous review comments
GET /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions
// +1 = 👍 (good comment, keep making these)
// -1 = 👎 (unhelpful, suppress this type)
```

The reaction + the comment text gives enough signal to extract a category of preference.

### Storage: `.github/copilot-learned.json` (committed by bot)

```json
{
  "version": 1,
  "suppressions": [
    { "pattern": "missing semicolons", "score": -3, "lastSeen": "2026-03-10" }
  ],
  "amplifications": [
    { "pattern": "error handling in async functions", "score": +5, "lastSeen": "2026-03-15" }
  ],
  "teamContext": [
    { "note": "We use our own auth middleware, don't flag JWT directly", "addedAt": "2026-03-12" }
  ]
}
```

### Flow per PR review run

```
1. Fetch previous bot comments + their reactions
2. Load .github/copilot-learned.json (if exists)
3. Update scores from new reactions since last run
4. Inject learned suppressions + amplifications into system prompt
5. Run review as normal
6. Commit updated .github/copilot-learned.json (only if scores changed)
```

### System prompt injection

```
## Learned Team Preferences

The following is based on team reactions to previous reviews:

SUPPRESS (team has 👎'd these repeatedly):
- Comments about missing semicolons (score: -3)

AMPLIFY (team has 👍'd these repeatedly):
- Error handling in async functions (score: +5)

CONTEXT NOTES (added by team):
- We use our own auth middleware; don't flag direct JWT usage.
```

### New ToolCategory needed

```typescript
"github.reactions.read"  // read reactions on bot comments
"repo.write"             // already exists — commit learned file
```

### Confirmed: No reactions API currently used

The codebase makes zero calls to GitHub's reactions endpoint. The gap is confirmed and clean to add.

### Precise extension points in current codebase

| What | Where | How to extend |
|---|---|---|
| Fetch reactions | `src/app/pr-data.ts` — `fetchExistingComments()` | Add reaction fetch alongside comment fetch |
| Marker parsing | `src/app/last-review.ts` | Add `findLearnedPrefs()` following same `<!-- sri:key:value -->` pattern |
| Inject into prompt | `src/prompts/review.ts` | Add learned prefs section to system prompt builder |
| Store updated prefs | `src/tools/review.ts` — `ensureSummaryFooter()` | Encode compact prefs in a new `<!-- sri:learned-prefs:{json} -->` marker, OR commit `.github/copilot-learned.json` via `repo.write` tool |
| New tool category | `src/tools/categories.ts` | Add `"github.reactions.read"` to `TOOL_CATEGORY_BY_NAME` |

---

## 9. Confidence Scoring (Low-effort gap)

Greptile includes a confidence score (0–5) per finding. This is purely a prompt-level addition:

```
For each finding, rate your confidence that this is a real issue (0–5):
5 = certain bug/security issue
4 = very likely problem
3 = probable issue
2 = possible concern
1 = minor style preference
0 = speculative

Include the score in findings output.
```

The `post_summary` structured output already has `verdict` — add `confidence` field.

---

## 10. Open Questions / NEEDS CLARIFICATION

1. **Reaction fetching scope**: Do we fetch reactions on ALL previous bot comments or only the most recent review batch? Fetching all is more complete but slower.

2. **Commit strategy for learned file**: Should the bot commit `.github/copilot-learned.json` after every run (noisy), or only when net score changes exceed a threshold?

3. **Bot identity for reactions**: Reactions are by user. If multiple team members react, do we aggregate all or only count repo members/collaborators?

4. **dora integration feasibility**: dora requires SCIP indexer install (~1-2 min on cold run). Is this acceptable for the action's runtime? Warm runs (same commit SHA) skip indexing.

5. **Learned file ownership**: Should `.github/copilot-learned.json` be gitignored (ephemeral) or committed (auditable)? Committed is auditable but creates bot commits on main.

---

## Summary: Recommended Next Steps (Priority Order)

| Priority | Feature | Effort | Infrastructure |
|---|---|---|---|
| 1 | **Reaction-based learning signal** — fetch 👍/👎 on bot comments | Low | None (GitHub API) |
| 2 | **Confidence scoring** — add 0–5 score to findings prompt | Very low | None |
| 3 | **dora integration** — SCIP-based cross-file analysis | Medium | dora CLI in Action |
| 4 | **Learned preferences file** — persist suppressions/amplifications | Medium | `repo.write` + commit |
| 5 | **click-style SQLite memory** — full structured memory | High | External DB or Gist |
