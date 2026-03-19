# Tasks

## Implementation Plan (Custom Prompts + Commands)

### Modules (new/updated)
- `src/app/reviewerc.ts`: load/parse `.reviewerc`, merge with action inputs, expose validated config.
- `src/commands/registry.ts`: command registry + lookup by id.
- `src/commands/args.ts`: parse `!command` / `@bot command` with quoted args.
- `src/commands/command-runner.ts`: execute a command against a review context (PR or scheduled).
- `src/app/mode.ts`: determine run mode from GitHub event + route to command lists.
- `src/tools/git-history.ts`: `git_log` / `git_diff_range` repo-history tools.
- `src/app/schedule.ts`: scheduled runner (job id → command list) + PR creation flow.
- `src/app/write-scope.ts`: enforce `writeScope` + blocked paths.

### Family Branch: config-core
- [ ] PR: `.reviewerc` loader + merge logic  
  Description: Read YAML, validate against schema, merge precedence (action inputs override), add types in `src/types.ts`.  
  DoD:
  - Config parsing fails fast with a clear error on invalid YAML or schema violations.
  - Unit tests added in `tests/config.test.ts` cover valid config, invalid config, and precedence (action inputs override).
  - README updated to document `.reviewerc` location + merge precedence.
  - Backward-compat: fail fast with clear error if removed keys (e.g., `schedule.output`) are present.
  Depends on: none.
- [ ] PR: Command registry + PR run selection  
  Description: Implement `commands` + `review.run` execution; map command id → prompt; default `comment.type: both`.  
  DoD:
  - Command lookup errors are explicit in logs when a configured command id is missing.
  - Unit tests cover command lookup success + missing id behavior.
  - Design doc updated to state PR default `comment.type: both`.
  Depends on: `.reviewerc` loader PR.

### Family Branch: triggers
- [ ] PR: Comment-triggered commands (`!command` / `@bot command`)  
  Description: Parse comment text with quoted args; ignore unknown commands; reject if not PR context; wire to command runner.  
  DoD:
  - Quoted args are parsed into `command.argv` exactly as documented.
  - Unknown commands are no-ops (no comment posted, no errors).
  - Non-PR comment invocations are rejected with a log message.
  - Unit tests cover quoted args, unknown command, and non-PR rejection.
  - Design doc updated with `!command "quoted args"` example.
  Depends on: command registry PR.
- [ ] PR: Event routing + context detection  
  Description: Select run mode based on GitHub event (`pull_request`, `issue_comment`, `schedule`) and route to correct command list.  
  DoD:
  - Event→mode mapping is deterministic and covered by tests.
  - Action logs the chosen mode and the command list it will run.
  - Design doc updated to describe routing logic.
  Depends on: command registry PR.

### Family Branch: scheduled-run
- [ ] PR: Scheduled command execution by job id  
  Description: Read `schedule.runs[GITHUB_JOB]`; no-op when missing; run commands using `git.history`.  
  DoD:
  - Missing job id mapping results in a no-op with a clear log line.
  - Unit tests cover job id mapping and no-op behavior.
  - Design doc updated with `schedule.runs` job id mapping example.
  Depends on: `.reviewerc` loader PR.
- [ ] PR: Git history tools + writeScope + PR creation  
  Description: Implement `git_log` / `git_diff_range`, enforce `writeScope` + blocked paths, deterministic bot branch, open/update PR.  
  DoD:
  - `git_log` and `git_diff_range` tools implemented with documented params (`sinceHours`, `from`, `to`, optional `paths`).
  - `writeScope` blocks writes outside allowed globs and blocks `.github/workflows/**` and `/.reviewerc`.
  - Bot branch name is deterministic and reused when updating an existing PR.
  - Unit tests cover writeScope enforcement and branch naming.
  - Design doc updated for `git.history` and safety guardrails.
  Depends on: scheduled command execution PR.

### Integration Gates (last PR per family)
- [ ] config-core: manual run with `.reviewerc` on a sample PR; verify logs show merged config + command ids.
- [ ] triggers: manual `!command "quoted args"` on a PR comment; verify correct command executed.
- [ ] scheduled-run: manual workflow dispatch with `GITHUB_JOB` mapped in `schedule.runs`; verify PR created.

---

## Learning/Memory System & Cross-File Intelligence

> Generated from `research.md`. See that file for full rationale and decisions.

### Dependency Graph

```
Phase F (Foundation types)
  └─► Phase US1 (Confidence Scoring)   ← independent, ships alone
  └─► Phase US2 (Reaction Signal)      ← independent of US1
        └─► Phase US3 (Persistence)    ← requires US2 reaction data
Phase US4 (dora)                       ← fully independent of US1/2/3
Phase POL (Polish)                     ← requires all previous phases
```

**Parallel opportunities:** US1 + US4 can be built simultaneously (zero shared files). US3 tasks are sequential within the story.

**MVP scope:** US1 + US2 = 13 tasks, zero infrastructure, working learning signal + confidence scoring.

---

### Phase F: Foundation — Shared Types

> Types-only phase. No behaviour yet — just interfaces that tests will import.

- [x] **TF.1** `types` `src/types.ts` — Add `confidence?: 0|1|2|3|4|5` to `Finding` interface
- [x] **TF.2** `types` `src/types.ts` — Add `ReactionSummary` interface `{ commentId, commentBody, thumbsUp, thumbsDown, netScore }`
- [x] **TF.3** `types` `src/types.ts` — Add `LearnedPrefs` interface `{ version: 1, suppressions[], amplifications[], teamContext[] }`
- [x] **TF.4** `types` `src/tools/categories.ts` — Add `"github.reactions.read"` and `"code.graph"` to `ToolCategory` union

---

### Phase US1: Confidence Scoring

**Goal:** Each finding includes a 0–5 confidence score. Low-confidence findings render with a `(?)` prefix.

**Test criteria:** `buildAdaptiveSummaryMarkdown()` renders correct prefix for each confidence tier; `report_finding` schema accepts `confidence`.

#### 🔴 RED — write failing tests first

- [x] **TUS1.1** `test` `tests/summary.test.ts` — Write failing tests for confidence rendering:
  - `confidence: 5` → no prefix
  - `confidence: 3` → `(~)` prefix
  - `confidence: 1` → `(?)` prefix
  - `confidence: 0` → `(speculative)` prefix
  - `confidence` absent → no prefix (backward compat)

#### 🟢 GREEN — implement to pass

- [x] **TUS1.2** `types` `src/summary.ts` — Add `confidence?: 0|1|2|3|4|5` to `StructuredSummaryFinding`; preserve in `sanitizeFindings()`
- [x] **TUS1.3** `summary` `src/summary.ts` — Implement `confidencePrefix()` + use in `renderFindingLine()`
- [x] **TUS1.4** `tools` `src/tools/review.ts` — Add `confidence` to `ReportFindingSchema` + pass through in execute handler
- [x] **TUS1.5** `prompt` `src/prompts/review.ts` — Extend `report_finding` TOOL_DOCS with confidence scale description

*TUS1.1 must be committed (failing) before TUS1.2–TUS1.5. TUS1.2 and TUS1.4 can be done in parallel.*

---

### Phase US2: Reaction-Based Learning Signal

**Goal:** Fetch 👍/👎 reactions on previous bot comments; inject "Learned Team Preferences" into system prompt each run. No persistence.

**Test criteria:** `buildLearnedPrefsPrompt()` returns correct sections for given reaction scores. `fetchReactionsForComment()` maps API response to `ReactionSummary`.

#### 🔴 RED — write failing tests first

- [x] **TUS2.1** `test` `tests/prompts.test.ts` — Write failing tests for `buildLearnedPrefsPrompt()`
- [x] **TUS2.2** `test` `tests/app-pr-data.test.ts` — Write failing tests for `fetchReactionsForBotComments()`

#### 🟢 GREEN — implement to pass

- [x] **TUS2.3** `github` `src/app/pr-data.ts` — Implement `fetchReactionsForBotComments()` using `reactions.listForIssueComment`
- [x] **TUS2.4** `prompt` `src/prompts/review.ts` — Implement `buildLearnedPrefsPrompt(reactions)` (exported)
- [ ] **TUS2.5** `app` `src/app/flow.ts` — Thread `botCommentReactions` through to `runReview()`
- [ ] **TUS2.6** `agent` `src/agent/review-runner.ts` — Accept `botCommentReactions` in review params + inject into system prompt

*TUS2.1 and TUS2.2 must be committed (failing) before TUS2.3+. TUS2.3 and TUS2.5 can be done in parallel.*

---

### Phase US3: Learned Preferences Persistence

**Goal:** Learned preferences survive across runs via `.github/copilot-learned.json` committed by the bot.

**Test criteria:** `mergeReactionsIntoPrefs()` correctly accumulates scores, decays stale entries, and removes zeros. `loadLearnedPrefs()` is null-safe on missing/corrupt file.

**Depends on:** US2 complete.

#### 🔴 RED — write failing tests first

- [ ] **TUS3.1** `test` `tests/learned-prefs.test.ts` *(new)* — Write failing tests for `src/app/learned-prefs.ts`:
  - `loadLearnedPrefs()` on missing file → `null`
  - `loadLearnedPrefs()` on corrupt JSON → `null` (no throw)
  - `mergeReactionsIntoPrefs(null, [reaction])` → creates new entry with score
  - `mergeReactionsIntoPrefs(existing, [sameReaction])` → accumulates score
  - `mergeReactionsIntoPrefs(existing, [])` with entry last seen >90 days → score decayed by 1
  - Entry with score reaching 0 after decay → removed from list
  - `saveLearnedPrefs()` called twice with identical content → file written only once (spy on `writeFileSync`)
- [ ] **TUS3.2** `test` `tests/config.test.ts` — Write failing tests for `learning` config option:
  - Action input `learning: "false"` → `config.learning === false`
  - `.reviewerc review.defaults.learning: false` → `config.learning === false`
  - Neither set → `config.learning === true` (default)

#### 🟢 GREEN — implement to pass

- [ ] **TUS3.3** `app` `src/app/learned-prefs.ts` *(new)* — Implement `loadLearnedPrefs(repoRoot)`, `mergeReactionsIntoPrefs(existing, reactions)`, `saveLearnedPrefs(prefs, repoRoot)`
- [ ] **TUS3.4** `config` `src/app/config.ts` — Add `learning?: boolean` (default `true`); read from `.reviewerc review.defaults.learning` and action input `learning`
- [ ] **TUS3.5** `config` `action.yml` — Add `learning` input (default `true`)
- [ ] **TUS3.6** `app` `src/app/flow.ts` — Load prefs at run start, merge with fresh reactions, pass merged to `runReview()`
- [ ] **TUS3.7** `prompt` `src/prompts/review.ts` — Update `buildLearnedPrefsPrompt()` to also accept `LearnedPrefs` (file prefs merged with fresh; fresh reactions take precedence on same pattern)
- [ ] **TUS3.8** `app` `src/app/flow.ts` — After review: `saveLearnedPrefs()` then commit via `octokit.repos.createOrUpdateFileContents()` only if content changed and `repo.write` in allowlist

*TUS3.1 and TUS3.2 committed (failing) before any GREEN tasks. TUS3.3 and TUS3.4 can be done in parallel.*

---

### Phase US4: dora Code Intelligence

**Goal:** Opt-in `use-dora: true` gives the review agent structured tools for call-graph queries backed by a SCIP index.

**Test criteria:** `createDoraTools()` returns correct tool count and names; each tool guard-checks index existence; config parsing maps inputs correctly.

**Depends on:** Nothing (fully independent).

#### 🔴 RED — write failing tests first

- [ ] **TUS4.1** `test` `tests/dora-tools.test.ts` *(new)* — Write failing tests for `src/tools/dora.ts`:
  - `createDoraTools(workingDir)` returns 6 tools with correct names (`dora_symbol`, `dora_refs`, `dora_deps`, `dora_rdeps`, `dora_smells`, `dora_cycles`)
  - Calling any tool when `.dora/` index absent → throws/returns error message (mock `existsSync`)
  - `dora_deps` with mocked `execSync` returning CLI output → parses output to string result
- [ ] **TUS4.2** `test` `tests/config.test.ts` — Write failing tests for dora config:
  - Action input `use-dora: "true"` → `config.dora.enabled === true`
  - No input → `config.dora.enabled === false` (default off)
  - `.reviewerc review.defaults.dora.enabled: true` → `config.dora.enabled === true`

#### 🟢 GREEN — implement to pass

- [ ] **TUS4.3** `types` `src/types.ts` — Add `dora?: { enabled: boolean; version?: string; preIndex?: string }` to `ReviewConfig`
- [ ] **TUS4.4** `types` `src/tools/categories.ts` — Add `"code.graph"` ToolCategory; map dora tools to it
- [ ] **TUS4.5** `tools` `src/tools/dora.ts` *(new)* — Implement `createDoraTools(workingDir)`: 6 bash-wrapper tools (`dora_symbol`, `dora_refs`, `dora_deps`, `dora_rdeps`, `dora_smells`, `dora_cycles`), each guards on `.dora/` index existence
- [ ] **TUS4.6** `config` `src/app/config.ts` — Read `use-dora` and `dora-version` inputs; merge with `.reviewerc review.defaults.dora`; default `enabled: false`
- [ ] **TUS4.7** `config` `action.yml` — Add inputs: `use-dora` (boolean, default `false`), `dora-version` (string, default `latest`), `dora-pre-index` (string, optional); add dora install + cache steps
- [ ] **TUS4.8** `agent` `src/agent/review-runner.ts` — When `config.dora?.enabled`: `createDoraTools()`, append to tool list (filtered by allowlist)
- [ ] **TUS4.9** `prompt` `src/prompts/review.ts` — Add dora usage instructions to system prompt when enabled

*TUS4.1 and TUS4.2 committed (failing) before TUS4.3+. TUS4.3–TUS4.5 can be done in parallel.*

---

### Phase POL: Polish & Cross-Cutting

#### 🔴 RED first

- [ ] **TPOL.1** `test` `tests/flow.test.ts` — Write failing integration tests:
  - `learning: true` + reactions present → system prompt contains `## Learned Team Preferences`
  - `learning: false` → system prompt does NOT contain learned prefs block
  - `learning: true` + `repo.write` not in allowlist → no commit attempt, logs warning

#### 🟢 GREEN

- [ ] **TPOL.2** `config` `src/app/config.ts` — Add warning log when `learning: true` but `repo.write` not in allowlist
- [ ] **TPOL.3** `schema` `schemas/reviewerc.schema.json` — Add schema entries for `review.defaults.learning` and `review.defaults.dora`
- [ ] **TPOL.4** `docs` `README.md` — Document `learning`, `use-dora`, `dora-version`; add "Learning from reactions" section

---

### Task Count

| Phase | 🔴 RED tasks | 🟢 GREEN tasks | Total |
|---|---|---|---|
| Foundation (types only) | — | 4 | 4 |
| US1 Confidence Scoring | 1 | 4 | 5 |
| US2 Reaction Signal | 2 | 6 | 8 |
| US3 Persistence | 2 | 6 | 8 |
| US4 dora | 2 | 7 | 9 |
| Polish | 1 | 3 | 4 |
| **Total** | **8** | **30** | **38** |

---

## Follow-up Ideas (Learnings from other agents)
- [ ] Add read-before-write guard for repo write tools (track reads in filesystem tools and enforce before write/apply_patch).
- [ ] Add patch-only mode / model-based gating (disable `write` + `edit`, allow `apply_patch`).
- [ ] Centralize tool registry and global gating (single place to enable/disable tool categories).
- [ ] Add post-write diagnostics (e.g., diff summary or lightweight lint) to tool results.
- [ ] Add subagent chaining and parallel execution modes (single tool call supports sequential `{previous}` and concurrent tasks).

## Testing Harness (Live LLM Snapshots)
- [x] Update config/docs to allow `api-key` for `google-vertex`.
- [x] Add LLM snapshot fixtures + runner (`tests/fixtures/llm/**`, `tests/llm-snapshots.test.ts`).
- [x] Add snapshot recording script (`scripts/record-llm.ts`) + package scripts.
- [x] Update CI to run `test:llm` on internal PRs (skip forks).
- [x] Patch `@mariozechner/pi-ai` for Vertex Express API key support (patch-package).
- [ ] Confirm live auth works: `GEMINI_API_KEY` must be a real Gemini API key (Vertex API keys return 401 "API keys are not supported").
- [ ] Verify: `bun test`, `bun run test:llm` (requires key), `bun run build`.
