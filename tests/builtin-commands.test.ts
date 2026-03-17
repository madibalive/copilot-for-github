import { test, expect } from "bun:test";
import { BUILTIN_COMMANDS } from "../src/commands/builtin.ts";
import { CommandRegistry } from "../src/commands/registry.ts";

const explainCommand = BUILTIN_COMMANDS.find((c) => c.id === "explain");

test("BUILTIN_COMMANDS includes an explain command", () => {
  expect(explainCommand).toBeDefined();
});

test("explain command has id 'explain'", () => {
  expect(explainCommand?.id).toBe("explain");
});

test("explain command has a non-empty prompt", () => {
  expect(explainCommand?.prompt.length).toBeGreaterThan(10);
});

test("explain command prompt contains ${command.args} placeholder for scoping", () => {
  expect(explainCommand?.prompt).toContain("${command.args}");
});

test("explain command restricts tools to filesystem and github.pr.read", () => {
  const allowed = explainCommand?.tools?.allow ?? [];
  expect(allowed).toContain("filesystem");
  expect(allowed).toContain("github.pr.read");
  // should NOT have feedback or write tools
  expect(allowed).not.toContain("github.pr.feedback");
  expect(allowed).not.toContain("github.pr.manage");
  expect(allowed).not.toContain("repo.write");
});

test("explain command posts as issue comment", () => {
  expect(explainCommand?.comment?.type).toBe("issue");
});

test("built-in explain is available in registry when no user commands defined", () => {
  const registry = new CommandRegistry([...BUILTIN_COMMANDS]);
  expect(registry.get("explain")).toBeDefined();
});

test("user-defined explain command overrides built-in", () => {
  const userExplain = { id: "explain", prompt: "Custom explain prompt." };
  const userDefinedIds = new Set([userExplain.id]);
  const effective = [
    ...BUILTIN_COMMANDS.filter((b) => !userDefinedIds.has(b.id)),
    userExplain,
  ];
  const registry = new CommandRegistry(effective as any);
  expect(registry.get("explain")?.prompt).toBe("Custom explain prompt.");
});

test("other built-in commands are not displaced when user overrides explain", () => {
  const userExplain = { id: "explain", prompt: "Custom." };
  const userDefinedIds = new Set([userExplain.id]);
  const effective = [
    ...BUILTIN_COMMANDS.filter((b) => !userDefinedIds.has(b.id)),
    userExplain,
  ];
  // All built-ins except explain should still be registered
  const registry = new CommandRegistry(effective as any);
  for (const builtin of BUILTIN_COMMANDS) {
    expect(registry.get(builtin.id)).toBeDefined();
  }
});
