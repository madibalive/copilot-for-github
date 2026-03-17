import fs from "node:fs";
import path from "node:path";

const DEFAULT_CONTEXT_FILE = ".github/copilot-context.md";

export function loadTeamContext(repoRoot: string, contextFile: string | undefined): string | null {
  const filePath = path.join(repoRoot, contextFile ?? DEFAULT_CONTEXT_FILE);
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, "utf8").trim();
  return content || null;
}
