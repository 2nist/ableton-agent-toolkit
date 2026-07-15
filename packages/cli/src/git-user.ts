import { execSync } from "node:child_process";

/** Best-effort `git config user.name` lookup for a sensible --author default. Returns undefined rather than throwing if git or the config value is unavailable. */
export function getGitUserName(): string | undefined {
  try {
    const name = execSync("git config user.name", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}
