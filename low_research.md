# Research: Low-Effort Feature Additions (Items 1–8)

## Overview

Research for 8 low-effort features derived from Greptile docs analysis. All findings below resolve implementation unknowns and define integration points.

---

## Feature 1: `greptile.json` Repo Config File

- **Decision:** Parse `greptile.json` as a secondary config layer merged into `ActionConfig`. Precedence: action inputs > `.reviewerc` > `greptile.json` > defaults.
- **Rationale:** Teams migrating from Greptile expect `greptile.json` to be respected. Fields overlap minimally with `.reviewerc`. Follows tools-first philosophy.
- **Alternatives considered:** greptile.json as sole config (rejected — .reviewerc is more comprehensive); separate/no merge (rejected — poor UX).
- **How to apply:**
  - Add `readGreptileJson(repoRoot)` in `src/app/reviewerc.ts`
  - Merge in `src/app/config.ts` after `readReviewerc()` — reviewerc overrides greptile.json
  - Add `schemas/greptile.json.schema.json` for validation
  - No `src/types.ts` changes needed — reuse existing `ReviewercConfig` shape
  - Merge rules/instructions by concatenation; filters/settings by precedence

---

## Feature 2: Trigger on Every Commit vs PR Open Only (`triggerOnUpdates`)

- **Decision:** Support both action input `trigger-on-updates` and `.reviewerc` field `review.defaults.triggerOnUpdates: boolean`. Default: `false` (review all PR event types). When `true`, skips `opened` events and only reviews on `synchronize` and `reopened`.
- **Rationale:** Follows existing dual-input pattern. Action input takes precedence over `.reviewerc`.
- **Alternatives considered:** Workflow YAML only (`types: [opened]`) — rejected, not per-repo configurable.
- **Precedence:** action input `trigger-on-updates` > `.reviewerc` `review.defaults.triggerOnUpdates` > `false`
- **How to apply:**
  - `action.yml` — add `trigger-on-updates` input (boolean string, `"true"`/`"false"`)
  - `schemas/reviewerc.schema.json` — add `triggerOnUpdates?: boolean` under `review.defaults`
  - `src/types.ts` — add `triggerOnUpdates?: boolean` to `ReviewDefaults`; add `triggerOnUpdates?: boolean` to `ReviewConfig`
  - `src/app/mode.ts` — capture `pull_request_action: "opened" | "synchronize" | "reopened"` in `RunMode`
  - `src/app/config.ts` — read `trigger-on-updates` input; fall back to `reviewDefaults.triggerOnUpdates`; store on `ReviewConfig`
  - `src/index.ts` — add guard: if `triggerOnUpdates === true` and action is `"opened"`, skip

---

## Feature 3: Skip Automatic Reviews (`skipAutomatic`)

- **Decision:** Support both action input `skip-automatic` and `.reviewerc` field `review.skipAutomatic: boolean`. Default: `false`. When `true`, `pull_request` events are silently skipped; manual `issue_comment` @mention triggers still run.
- **Rationale:** Follows existing dual-input pattern. Aligns with Greptile's `skipReview: "AUTOMATIC"`.
- **Precedence:** action input `skip-automatic` > `.reviewerc` `review.skipAutomatic` > `false`
- **How to apply:**
  - `action.yml` — add `skip-automatic` input (boolean string)
  - `schemas/reviewerc.schema.json` — add `skipAutomatic?: boolean` under `review`
  - `src/types.ts` — add `skipAutomatic?: boolean` to `ReviewercConfig.review`; add `skipAutomatic?: boolean` to `ActionConfig`
  - `src/app/config.ts` — read `skip-automatic` input; fall back to `reviewerc.review.skipAutomatic`; store on `ActionConfig`
  - `src/index.ts` lines 25–39 — add guard at top of `pull_request` branch:
    ```ts
    if (actionConfig.skipAutomatic) {
      core.info("Automatic reviews disabled. Trigger manually via @mention.");
      return;
    }
    ```

---

## Feature 4: Label-Based Review Filtering

- **Decision:** Support both action inputs `include-labels` / `exclude-labels` (comma-separated) and `.reviewerc` fields `review.labelFilters.include` / `review.labelFilters.exclude`. Fetch PR labels from GitHub API and guard in `flow.ts` after `fetchPrData()`.
- **Rationale:** Follows comma-separated pattern of existing `ignore-patterns` input. PR labels must be fetched — not currently in `PullRequestInfo`.
- **Precedence:** action inputs > `.reviewerc` `review.labelFilters` > no filter
- **How to apply:**
  - `action.yml` — add `include-labels` and `exclude-labels` inputs (comma-separated strings)
  - `src/types.ts` — add `labels: string[]` to `PullRequestInfo`; add `labelFilters?: IncludeExclude` to `ReviewConfig`
  - `src/app/pr-data.ts` — extract `pr.data.labels.map(l => l.name)` in `fetchPrData()`
  - `src/app/config.ts` — parse comma-separated inputs; merge with `.reviewerc` values (input wins)
  - `src/app/flow.ts` after line 56 — add `passesLabelFilters(prInfo.labels, reviewConfig.labelFilters)` guard
  - Reuse `IncludeExclude` logic from `src/app/schedule.ts`

---

## Feature 5: Author Include/Exclude Filters

- **Decision:** Support both action inputs `include-authors` / `exclude-authors` (comma-separated) and `.reviewerc` fields `review.authorFilters.include` / `review.authorFilters.exclude`. Exact string match against `prInfo.author`.
- **Rationale:** Follows comma-separated pattern. `prInfo.author` already available.
- **Precedence:** action inputs > `.reviewerc` `review.authorFilters` > no filter
- **How to apply:**
  - `action.yml` — add `include-authors` and `exclude-authors` inputs (comma-separated strings)
  - `src/types.ts` — add `authorFilters?: IncludeExclude` to `ReviewConfig`
  - `src/app/config.ts` — parse comma-separated inputs; merge with `.reviewerc` (input wins)
  - `src/app/flow.ts` after line 56 — add `passesAuthorFilters(prInfo.author, reviewConfig.authorFilters)` guard
  - Exact match (case-sensitive); common bot patterns: `["dependabot[bot]", "renovate[bot]"]`

---

## Feature 6: Branch Include/Exclude Filters

- **Decision:** Support both action inputs `include-branches` / `exclude-branches` (comma-separated, glob-enabled) and `.reviewerc` fields `review.branchFilters.include` / `review.branchFilters.exclude`. Applies to `prInfo.headRef`.
- **Rationale:** Follows comma-separated pattern. `minimatch` already in `package.json`; reuse from `schedule.ts`.
- **Glob support:** Yes — `main`, `release/*`, `hotfix/*`, `feature/**`.
- **Precedence:** action inputs > `.reviewerc` `review.branchFilters` > no filter
- **How to apply:**
  - `action.yml` — add `include-branches` and `exclude-branches` inputs (comma-separated strings)
  - `src/types.ts` — add `branchFilters?: IncludeExclude` to `ReviewConfig`
  - `src/app/config.ts` — parse comma-separated inputs; merge with `.reviewerc` (input wins)
  - `src/app/flow.ts` after line 56 — add `passesBranchFilters(prInfo.headRef, reviewConfig.branchFilters)` guard
  - Reuse include/exclude + minimatch logic from `src/app/schedule.ts:80–91`

---

## Feature 7: Keyword Triggers (PR Title/Body)

- **Decision:** Support both action inputs `skip-keywords` / `include-keywords` (comma-separated) and `.reviewerc` fields `review.keywordFilters.skipKeywords` / `review.keywordFilters.includeKeywords`. Case-insensitive substring match against `${prInfo.title} ${prInfo.body}`.
- **Rationale:** Follows comma-separated pattern. `prInfo.title` and `prInfo.body` already available.
- **Precedence:** action inputs > `.reviewerc` `review.keywordFilters` > no filter
- **How to apply:**
  - `action.yml` — add `skip-keywords` and `include-keywords` inputs (comma-separated strings)
  - `src/types.ts` — add `KeywordFilters` interface; add `keywordFilters?: KeywordFilters` to `ReviewConfig`
  - `src/app/config.ts` — parse comma-separated inputs; merge with `.reviewerc` (input wins)
  - `src/app/flow.ts` after line 56 — add `passesKeywordFilters(prInfo.title, prInfo.body, reviewConfig.keywordFilters)` guard:
    ```ts
    const text = `${title} ${body}`.toLowerCase();
    if (skipKeywords?.some(kw => text.includes(kw.toLowerCase()))) return false;
    if (includeKeywords?.length && !includeKeywords.some(kw => text.includes(kw.toLowerCase()))) return false;
    ```
  - Common patterns to document: `skip-keywords: "[WIP],[DO NOT REVIEW],draft:"`

---

## Feature 8: Max File Count Limit (`maxFiles` in `.reviewerc`)

- **Decision:** Already implemented at action-input level (`max-files` → `ReviewConfig.maxFiles` → `flow.ts:106`). Gap: cannot be set in `.reviewerc`. Add `maxFiles?: number` to `ReviewDefaults`.
- **Rationale:** Core behavior already works. Just needs `.reviewerc` configurability to match the dual-input pattern.
- **Precedence:** action input `max-files` > `.reviewerc` `review.defaults.maxFiles` > `50` (current default)
- **How to apply:**
  - `src/types.ts` — add `maxFiles?: number` to `ReviewDefaults`
  - `schemas/reviewerc.schema.json` — add `maxFiles` (integer, minimum: 1) to `reviewDefaults`
  - `src/app/config.ts` — fall back to `reviewDefaults.maxFiles` when `max-files` action input not set (already reads `maxFilesInput ?? String(DEFAULT_MAX_FILES)` — change to `maxFilesInput ?? (reviewDefaults.maxFiles ? String(reviewDefaults.maxFiles) : String(DEFAULT_MAX_FILES))`)

---

## All Affected Files (consolidated)

| File | Features |
|------|----------|
| `src/types.ts` | 1, 2, 3, 4, 5, 6, 7, 8 |
| `src/app/config.ts` | 1, 2, 3, 8 |
| `src/app/reviewerc.ts` | 1 |
| `src/app/flow.ts` | 4, 5, 6, 7 |
| `src/app/pr-data.ts` | 4 |
| `src/app/mode.ts` | 2 |
| `src/index.ts` | 2, 3 |
| `schemas/reviewerc.schema.json` | 2, 3, 8 |
| `schemas/greptile.json.schema.json` | 1 (new file) |

---

## Implementation Order (suggested)

1. **Feature 8** — `maxFiles` in `.reviewerc` (smallest change, isolated to config layer)
2. **Feature 3** — `skipAutomatic` (1 schema field + 1 guard in index.ts)
3. **Feature 2** — `triggerOnUpdates` (schema + mode.ts + index.ts guard)
4. **Features 5 & 7** — author + keyword filters (no new deps, pure logic in flow.ts)
5. **Feature 6** — branch filters (reuse minimatch from schedule.ts)
6. **Feature 4** — label filters (requires pr-data.ts change to fetch labels)
7. **Feature 1** — greptile.json parsing (most cross-cutting, save for last)
