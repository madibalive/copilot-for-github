import type { CommandDefinition } from "../types.js";

export const BUILTIN_COMMANDS: CommandDefinition[] = [
  {
    id: "explain",
    title: "Explain code changes",
    prompt:
      "Explain the code changes in this pull request clearly and concisely.\n\n" +
      'If the user specified a focus area ("${command.args}"), concentrate the explanation there. ' +
      "Otherwise explain the overall changes.\n\n" +
      "Cover:\n" +
      "- What changed and why (from the PR description and the code itself)\n" +
      "- How the key changes work at a high level\n" +
      "- Any non-obvious design decisions or trade-offs\n\n" +
      "Write in plain English suitable for a team member who knows the language but may be unfamiliar with this area of the codebase. " +
      "Post as a single clear comment.",
    tools: {
      allow: ["filesystem", "github.pr.read"],
    },
    comment: {
      type: "issue",
    },
  },
];
