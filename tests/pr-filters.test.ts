import { test, expect } from "bun:test";
import {
  passesAuthorFilter,
  passesKeywordFilter,
  passesBranchFilter,
  passesLabelFilter,
} from "../src/app/pr-filters.ts";

// --- passesAuthorFilter ---

test("passesAuthorFilter: passes when no filters set", () => {
  expect(passesAuthorFilter("alice", undefined)).toBe(true);
});

test("passesAuthorFilter: passes when author in include list", () => {
  expect(passesAuthorFilter("alice", { include: ["alice", "bob"] })).toBe(true);
});

test("passesAuthorFilter: fails when author not in include list", () => {
  expect(passesAuthorFilter("carol", { include: ["alice", "bob"] })).toBe(false);
});

test("passesAuthorFilter: passes when author not in exclude list", () => {
  expect(passesAuthorFilter("alice", { exclude: ["bot", "dependabot[bot]"] })).toBe(true);
});

test("passesAuthorFilter: fails when author in exclude list", () => {
  expect(passesAuthorFilter("dependabot[bot]", { exclude: ["dependabot[bot]", "renovate[bot]"] })).toBe(false);
});

test("passesAuthorFilter: fails when author in exclude list (renovate)", () => {
  expect(passesAuthorFilter("renovate[bot]", { exclude: ["dependabot[bot]", "renovate[bot]"] })).toBe(false);
});

test("passesAuthorFilter: passes with empty include array", () => {
  expect(passesAuthorFilter("alice", { include: [] })).toBe(true);
});

test("passesAuthorFilter: passes with empty exclude array", () => {
  expect(passesAuthorFilter("alice", { exclude: [] })).toBe(true);
});

// --- passesKeywordFilter ---

test("passesKeywordFilter: passes when no filters set", () => {
  expect(passesKeywordFilter("My PR", "some body", undefined)).toBe(true);
});

test("passesKeywordFilter: fails when skipKeyword found in title (case-insensitive)", () => {
  expect(passesKeywordFilter("[WIP] my feature", "body", { skipKeywords: ["[WIP]"] })).toBe(false);
});

test("passesKeywordFilter: fails when skipKeyword found in title (uppercase)", () => {
  expect(passesKeywordFilter("WIP: my feature", null, { skipKeywords: ["wip"] })).toBe(false);
});

test("passesKeywordFilter: fails when skipKeyword found in body", () => {
  expect(passesKeywordFilter("normal title", "DO NOT REVIEW this PR", { skipKeywords: ["do not review"] })).toBe(false);
});

test("passesKeywordFilter: passes when no skipKeyword found", () => {
  expect(passesKeywordFilter("my feature", "body text", { skipKeywords: ["[WIP]", "DO NOT REVIEW"] })).toBe(true);
});

test("passesKeywordFilter: fails when includeKeywords required but none found", () => {
  expect(passesKeywordFilter("my feature", "body text", { includeKeywords: ["[NEEDS REVIEW]"] })).toBe(false);
});

test("passesKeywordFilter: passes when includeKeyword found in title", () => {
  expect(passesKeywordFilter("[NEEDS REVIEW] my feature", "body", { includeKeywords: ["[needs review]"] })).toBe(true);
});

test("passesKeywordFilter: passes when includeKeyword found in body", () => {
  expect(passesKeywordFilter("title", "please review this", { includeKeywords: ["please review"] })).toBe(true);
});

test("passesKeywordFilter: handles null body gracefully", () => {
  expect(passesKeywordFilter("[WIP] title", null, { skipKeywords: ["[wip]"] })).toBe(false);
});

test("passesKeywordFilter: passes with empty skipKeywords array", () => {
  expect(passesKeywordFilter("title", "body", { skipKeywords: [] })).toBe(true);
});

// --- passesBranchFilter ---

test("passesBranchFilter: passes when no filters set", () => {
  expect(passesBranchFilter("main", undefined)).toBe(true);
});

test("passesBranchFilter: passes exact match on include list", () => {
  expect(passesBranchFilter("main", { include: ["main", "master"] })).toBe(true);
});

test("passesBranchFilter: passes glob match (release/*)", () => {
  expect(passesBranchFilter("release/1.0", { include: ["release/*"] })).toBe(true);
});

test("passesBranchFilter: fails when branch not in include list", () => {
  expect(passesBranchFilter("feature/foo", { include: ["main", "release/*"] })).toBe(false);
});

test("passesBranchFilter: fails when branch matches exclude glob", () => {
  expect(passesBranchFilter("dependabot/npm/lodash", { exclude: ["dependabot/**"] })).toBe(false);
});

test("passesBranchFilter: passes when branch does not match exclude glob", () => {
  expect(passesBranchFilter("feature/my-feature", { exclude: ["dependabot/**"] })).toBe(true);
});

test("passesBranchFilter: passes with empty include array", () => {
  expect(passesBranchFilter("main", { include: [] })).toBe(true);
});

// --- passesLabelFilter ---

test("passesLabelFilter: passes when no filters set", () => {
  expect(passesLabelFilter(["bug", "enhancement"], undefined)).toBe(true);
});

test("passesLabelFilter: passes when PR has required include label", () => {
  expect(passesLabelFilter(["bug", "review-needed"], { include: ["review-needed"] })).toBe(true);
});

test("passesLabelFilter: fails when PR missing all include labels", () => {
  expect(passesLabelFilter(["bug"], { include: ["review-needed"] })).toBe(false);
});

test("passesLabelFilter: fails when PR has excluded label", () => {
  expect(passesLabelFilter(["wip", "bug"], { exclude: ["wip"] })).toBe(false);
});

test("passesLabelFilter: passes when PR has no excluded labels", () => {
  expect(passesLabelFilter(["bug", "enhancement"], { exclude: ["wip", "skip-review"] })).toBe(true);
});

test("passesLabelFilter: fails with empty labels when include filter set", () => {
  expect(passesLabelFilter([], { include: ["review-needed"] })).toBe(false);
});

test("passesLabelFilter: passes with empty labels and no include filter", () => {
  expect(passesLabelFilter([], { exclude: ["wip"] })).toBe(true);
});
