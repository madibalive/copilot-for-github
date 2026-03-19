# Tasks: Hashline Reads + System Prompt Pruning

> Generated from [research.md](research.md). No test tasks (not requested).

## Feature Scope

| User Story | Description | Priority | Effort |
|---|---|---|---|
| US1 | Hashline read annotations — `read` tool outputs `lineNum:hash\|content` | P1 | Medium |
| US2 | Hashline suggest verification — `suggest` tool rejects stale line anchors | P1 | Low |
| US3 | System prompt pruning (TTSR Lite) — remove rules duplicated in tool descriptions | P2 | Low |

**Story dependencies:** US2 depends on US1 (needs hashlines in reads to have hashes to verify). US3 is independent.

---

## Dependency Graph

```
Foundational (T001–T004)
  └── US1 (T005–T009)
        └── US2 (T010–T013)
US3 (T014–T015)  ← independent, can run in parallel with everything above
```

---

## Phase 2: Foundational — Config Type System

> Must complete before US1 and US2. T001, T002, T003 are parallelizable.

**Goal:** Wire `hashlinesEnabled` from `.reviewerc` → `ReviewConfig` so all downstream tools can read it.

**Independent test criteria:** After this phase, a `.reviewerc` with `review.experimental.hashlinesEnabled: true` passes schema validation and the value appears on the `ReviewConfig` object at runtime.

- [x] T001 [P] Add `hashlinesEnabled?: boolean` to `ReviewercConfig.review.experimental` interface in [src/types.ts](src/types.ts)
- [x] T002 [P] Add `hashlinesEnabled?: boolean` to `ReviewConfig` interface in [src/types.ts](src/types.ts)
- [x] T003 [P] Add `"hashlinesEnabled": { "type": "boolean" }` to `reviewExperimental.$defs` in [schemas/reviewerc.schema.json](schemas/reviewerc.schema.json)
- [x] T004 Read `reviewerc?.review?.experimental?.hashlinesEnabled ?? false` in [src/app/config.ts](src/app/config.ts) and assign to `review.hashlinesEnabled`

---

## Phase 3: US1 — Hashline Read Annotations

> Depends on: T001–T004.

**Story goal:** When `hashlinesEnabled` is true, the `read` tool returns lines prefixed as `lineNum:hash|content`. The model receives a stable coordinate system that doesn't drift with whitespace.

**Independent test criteria:** Call `read` on any file with hashlines enabled; every line in the response matches `^\d+:[0-9a-f]{4}\|`.

- [x] T005 [P] [US1] Add `hashLine(lineNum: number, content: string): string` helper in [src/tools/fs.ts](src/tools/fs.ts) — uses `node:crypto` md5 (first 4 hex chars), formats as `${lineNum}:${hash}|${content}`
- [x] T006 [P] [US1] Update `createReadOnlyTools` signature in [src/tools/fs.ts](src/tools/fs.ts) to accept a second parameter `opts: { hashlines?: boolean } = {}`
- [x] T007 [US1] In `readTool.execute` in [src/tools/fs.ts](src/tools/fs.ts), when `opts.hashlines` is true, map each output line through `hashLine(lineNum, line)` before joining
- [x] T008 [US1] Pass `{ hashlines: config.hashlinesEnabled }` to `createReadOnlyTools` in [src/agent/review-runner.ts](src/agent/review-runner.ts)
- [x] T009 [US1] Export `HASHLINE_SYSTEM_NOTE` from [src/prompts/review.ts](src/prompts/review.ts) and append `if (config.hashlinesEnabled) systemPrompt += HASHLINE_SYSTEM_NOTE` in [src/agent/review-runner.ts](src/agent/review-runner.ts)

---

## Phase 4: US2 — Hashline Suggest Verification

> Depends on: T001–T009 (US1 must be complete — model must be producing hashes before verification is meaningful).

**Story goal:** When a model posts a suggestion with a `content_hash`, the `suggest` tool re-reads the target line, hashes it, and rejects the call if the hashes don't match. Prevents wrong-line suggestions silently landing on GitHub.

**Independent test criteria:** Call `suggest` with a `content_hash` that doesn't match the actual line content; tool returns an error, no GitHub API call is made. Call with matching hash; suggestion posts normally.

- [x] T010 [P] [US2] Add optional `content_hash?: string` field to `SuggestSchema` in [src/tools/review.ts](src/tools/review.ts)
- [x] T011 [P] [US2] Add `repoRoot?: string` and `hashlinesEnabled?: boolean` to `ReviewToolDeps` interface in [src/tools/review.ts](src/tools/review.ts)
- [x] T012 [US2] In `suggestTool.execute` in [src/tools/review.ts](src/tools/review.ts), add hash verification block using `node:crypto` md5; rejects before GitHub API call on mismatch
- [x] T013 [US2] Pass `repoRoot: config.repoRoot` and `hashlinesEnabled: config.hashlinesEnabled` to `createReviewTools` in [src/agent/review-runner.ts](src/agent/review-runner.ts)

---

## Phase 5: US3 — System Prompt Pruning (TTSR Lite)

> Independent — no dependency on US1/US2. Can run in parallel with Phase 2–4.

**Story goal:** Remove system prompt text that duplicates what tool `description` fields already say. Reduces token cost per review with no behavior change.

**Independent test criteria:** System prompt character count decreases. All tool-specific guidance that was duplicated is now only in `description` fields. `bun test` passes.

- [x] T014 [US3] Audit [src/prompts/review.ts](src/prompts/review.ts) — identified duplicates: `validate_mermaid` workflow step duplicates TOOL_DOCS entry; `terminate` workflow step duplicates TOOL_DOCS entry
- [x] T015 [US3] Removed duplicate workflow steps from [src/prompts/review.ts](src/prompts/review.ts): `validate_mermaid` step replaced with comment; `terminate` step removed; `post_summary` step simplified from "exactly once" to "Post summary." (TOOL_DOCS carries the detail)

---

## Final Phase: Polish & Cross-Cutting

- [x] T016 Verify `bun run build` succeeds — clean, zero errors
- [x] T017 Update the `smoke.mjs` test notes or README to document the `review.experimental.hashlinesEnabled` toggle

---

## Implementation Strategy

**MVP scope (Phase 2 + Phase 3 only = T001–T009):** Read tool annotations are independently useful even without suggest verification. A user gets hash-annotated reads and the model can see them. US2 adds the enforcement layer.

**Suggested execution order:**
1. T001 + T002 + T003 in parallel (types + schema, ~5 min)
2. T004 (config wiring, ~5 min)
3. T005 + T006 in parallel (helper + signature, ~10 min)
4. T007 → T008 → T009 sequentially (logic → wiring → prompt, ~20 min)
5. T010 + T011 in parallel (schema + deps, ~5 min)
6. T012 → T013 (verification logic → wiring, ~15 min)
7. T014 → T015 in parallel with anything above (independent, ~20 min)
8. T016 + T017

**Total task count:** 17
**Per story:** US1=5, US2=4, US3=2, Foundational=4, Polish=2
**Parallel opportunities:** T001/T002/T003, T005/T006, T010/T011, US3 fully independent
