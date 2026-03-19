# Research: oh-my-pi / Harness Problem Feature Adoption

> Sources:
> - https://blog.can.ac/2026/02/12/the-harness-problem/
> - https://github.com/can1357/oh-my-pi
> - Current codebase (src/tools/fs.ts, src/tools/review.ts, src/summary.ts, src/tools/subagent.ts)

---

## Summary

The harness problem blog post benchmarks 16 models across three edit tools (patch, string-replace, hashline) and shows that **edit tool design has as much impact on measured performance as model capability**. The weakest model gains jump from 6.7% → 68.3% success with hashline. oh-my-pi is a full coding agent that implements hashline plus many other advanced features.

For this project (a GitHub Actions PR review agent), most oh-my-pi features are environment-inappropriate (LSP servers, browser, SSH, image generation) or already implemented (context compaction, web search, structured findings). Two features warrant adoption:

1. **Hashline read annotations** — directly applicable to the `read` tool
2. **TTSR (Time Traveling Streamed Rules)** — worth tracking, needs infrastructure support

---

## Feature Analysis

### 1. Hashline Read Annotations

**Decision: ADOPT**

**What it is:**
Each line gets a short (2–3 char) content hash prepended when a file is read:
```
11:a3|function hello() {
22:f1|  return "world";
33:0e|}
```

Models reference the hash tag when editing/commenting instead of reproducing exact content. The runtime verifies the hash still matches before applying.

**Why it matters for this project:**
- The agent reads files and then posts inline comments anchored to line numbers. If the file has local changes or CRLF differences, the anchor silently drifts.
- The `suggest` tool posts GitHub suggestions anchored to `(path, line)`. A hash would let us detect stale anchors at post time: if the hash in the tool call doesn't match what we read from the blob, the suggestion is rejected before it's posted as a wrong-line edit.
- Weaker / cheaper models (used for cost-sensitive repos) show the largest gains. The blog benchmarks Grok Code Fast at 6.7% → 68.3% — a review agent running on budget models would benefit similarly.
- The current `read` tool outputs raw text with no per-line identity. Line numbers are only shown for partial reads. Hash-annotated output gives the model a stable coordinate system independent of surrounding context drift.

**Where to implement:**
- [src/tools/fs.ts](src/tools/fs.ts) — `readTool.execute`: when hashlines are enabled globally, annotate each line with `lineNum:hash|content` before returning.
- Hash function: CRC32 over the raw line bytes → 4-char hex. Fast, no external dep (`Bun.CryptoHasher`).
- Toggle is **operator-controlled via `.reviewerc`** (see below), not a tool parameter. The model always gets annotated output when the feature is on; it doesn't opt in per call.
- Add optional `content_hash` field to the `suggest` tool schema in [src/tools/review.ts](src/tools/review.ts). When the model passes a hash, the tool re-reads the target line before posting and rejects if the hash doesn't match. If absent, the suggestion posts without verification (graceful degradation).

**Toggle via `.reviewerc`:**
```yaml
review:
  experimental:
    hashlinesEnabled: true
```
This follows the existing `prExplainer` pattern in `ReviewercConfig.review.experimental`. When enabled:
1. `createReadOnlyTools` receives a `hashlines: boolean` flag and annotates read output.
2. The system prompt gains a short instruction: "File reads use `lineNum:hash|content` format. When posting suggestions, include the `content_hash` from the line you're targeting."
3. No action input needed initially (experimental features live in `.reviewerc` only until stable).

**Rationale:** Lowest-risk, highest-leverage change. The read tool is already the primary context-gathering tool. Hashes are additive to existing output format; no existing tests break. Verification catches stale suggestion anchors silently, reducing noise.

**Alternatives considered:**
- **Keep current approach:** Works for strong models on stable files; fails silently on CRLF/whitespace drift or when model miscounts lines.
- **Full file SHA per read call:** Tells us if the file changed, not which line. Not granular enough for suggestion verification.
- **Git blob SHA per line (git blame style):** Accurate but requires a `git blame` subprocess; much heavier and adds network round-trip in GitHub Actions.
- **String-replace style:** Already how GitHub suggestions work (match content, not position). But the model needs to emit the exact original content, which is the exact failure mode the blog documents.

**Open questions / NEEDS CLARIFICATION:**
- What hash length to use? Blog uses 2–3 chars. Collision probability for a 400-line file with 4-hex-char hash: ~0.25% per line pair. Acceptable for verification but worth noting.
- Should hashline mode be on by default or require opt-in via `action.yml` input? Default-on is simpler; opt-in lets users debug without the annotation noise.
- Does the GitHub Suggestions API care about the original line content for validation? (If so, hashes provide a second layer of defense beyond GitHub's own matching.)

---

### 2. Time Traveling Streamed Rules (TTSR)

**Decision: TRACK — do not adopt now, revisit when agent framework supports streaming injection**

**What it is:**
Rules/instructions in the system prompt have zero upfront token cost. They "activate" (are injected into context) only when the model's streamed output matches a trigger pattern. For example, the `suggest` tool guidance is injected only after the model emits the string `"suggest"`.

**Why it matters for this project:**
- The review system prompt ([src/prompts/review.ts](src/prompts/review.ts)) is already large: file inventory, prior review state, tool schemas, behavioral rules. TTSR would defer tool-specific guidance (e.g., "when posting suggestions, always include rationale") until the tool is actually invoked, cutting prompt tokens for simple PRs.
- Token cost per review scales with prompt length × PR complexity. For a PR that only needs one `comment` call, all the `suggest`-specific guidance is wasted context.

**Why not now:**
- Requires streaming-aware injection in the agent loop layer (`@mariozechner/pi-agent-core`). The current `agent.ts` / `agent-setup.ts` don't expose streaming intercepts.
- Would need upstream changes to `pi-agent-core` or a fork/wrapper.
- The ROI is modest for frontier models (which handle long prompts efficiently); the gain is larger for smaller/cheaper models.

**Alternatives considered:**
- **Chunked tool descriptions:** Move verbose per-tool guidance from system prompt into the tool's `description` field. Tools already have descriptions; this is the simple version of TTSR — tool-specific text only enters context when the tool is listed, not when it's invoked. Already partially done.
- **Shorter system prompt:** Prune guidance that repeats what tool descriptions already say. Low effort, immediate win, no infrastructure changes.
- **Full TTSR:** Maximum token savings but high implementation cost.

**Recommended intermediate step:** Audit the system prompt for rules that duplicate tool description content and remove the duplication. This captures ~30–50% of TTSR's token savings with zero infrastructure changes.

---

### 3. Structured Code Review Findings (Priority-based Verdicts)

**Decision: ALREADY IMPLEMENTED — no action needed**

oh-my-pi's reviewer uses priority-based findings with structured verdicts. Our `summary.ts` already defines:
- `StructuredSummaryFinding` with `category`, `severity` (low/medium/high), `status` (new/resolved/still_open), `confidence` (0–5), `evidence[]`, `action`
- `SummaryMode` (compact/standard/alert)
- 8 categories (Bug, Security, Performance, Unused Code, Duplicated Code, Refactoring, Design, Documentation)

The one gap: no explicit **priority** field distinct from severity. Severity = how bad; priority = what to fix first (e.g., a low-severity security issue may have higher priority than a high-severity style issue). Could add `priority: "critical" | "high" | "medium" | "low"` to `StructuredSummaryFinding` but this is a refinement, not a gap.

---

### 4. Parallel Subagent Execution

**Decision: INVESTIGATE — check current subagent.ts parallelism limits**

oh-my-pi supports up to 100 background jobs with configurable concurrency. The project has [src/tools/subagent.ts](src/tools/subagent.ts). Need to verify whether parallel subagent invocations are currently serialized or truly parallel, and whether GitHub Actions resource limits constrain this.

**If currently serialized:** Add `Promise.all` dispatch for independent file analysis subagents. The review of `src/foo.ts` is independent of `src/bar.ts`; parallel dispatch would cut wall time proportionally.

**Alternatives:** Leave serialized. Review is already fast enough for most PRs; parallelism adds complexity and increases API rate limit exposure.

---

### 5. LSP Integration

**Decision: SKIP**

oh-my-pi has 11 LSP operations across 40+ languages. This requires:
- A running LSP server in the execution environment
- The project's dependencies installed (for TypeScript LSP, needs `node_modules`)
- Persistent process management

GitHub Actions runners have the project checked out but not necessarily installed (depends on workflow config). The LSP server would need to start, index the project, then respond — adding 10–30s of startup latency per review.

**Alternative:** For TypeScript type errors, use `tsc --noEmit` as a subprocess tool. For linting, use `eslint`. These are lighter and more reliable in CI than LSP.

---

### 6. Context Compaction

**Decision: ALREADY IMPLEMENTED**

[src/agent/context-compaction.ts](src/agent/context-compaction.ts) exists. No action needed.

---

### 7. Multi-provider Web Search

**Decision: LOW PRIORITY**

oh-my-pi supports 9 providers. Current [src/tools/web-search.ts](src/tools/web-search.ts) uses Gemini. The review use case rarely needs web search (it's about the code in the PR, not external docs). Adding providers would be a quality-of-life improvement for rare cases; not worth the complexity now.

---

## Implementation Priority

| Feature | Priority | Effort | Impact |
|---|---|---|---|
| Hashline read annotations | **High** | Medium | High — catches stale anchors, improves weaker model accuracy |
| Hashline suggest verification | **High** | Low | High — prevents wrong-line suggestions silently |
| System prompt pruning (TTSR lite) | **Medium** | Low | Medium — immediate token savings, no infra changes |
| Parallel subagents | Low | Low | Low — review fast enough today |
| TTSR full | Backlog | High | Medium — needs upstream infra |
| LSP integration | Skip | Very High | Low in CI context |

---

## Resolved Decisions

| Question | Decision | Rationale |
|---|---|---|
| Adopt hashline? | Yes, in `read` tool | Highest leverage change; additive to existing output; direct verification benefit |
| Hash function | CRC32 → 4-char hex | Fast, Bun-native (`Bun.CryptoHasher`), low collision rate for file sizes seen in PRs |
| Default on or opt-in? | Opt-in via `.reviewerc` `review.experimental.hashlinesEnabled` | Operator controls it, not the model. Avoids annotation noise for users who don't need it; can promote to default later |
| Full TTSR? | No now | Requires agent framework changes upstream |
| LSP? | No | CI environment constraint |
| Parallel subagents? | Investigate first | Verify if already parallel before adding complexity |
