import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../..");
const gitDirectory = resolve(repoRoot, ".git");

if (!existsSync(gitDirectory)) {
	console.log("Skipped Git hook setup: .git directory not found.");
	process.exit(0);
}

try {
	execFileSync("git", ["config", "--local", "core.hooksPath", ".githooks"], {
		cwd: repoRoot,
		stdio: "ignore",
	});
	console.log("Configured Git hooks path: .githooks");
} catch (error) {
	console.warn(
		error instanceof Error
			? `Failed to configure Git hooks automatically: ${error.message}`
			: "Failed to configure Git hooks automatically.",
	);
}
