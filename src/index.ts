#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runOrchestrator } from "./orchestrator.js";

program()
  .then(() => void 0)
  .catch((err) => {
    console.error(pc.red("Fatal:"), err);
    process.exitCode = 1;
  });

async function program() {
  const program = new Command();

  program
    .name("subcalc-agents")
    .description("Run Builder + Verifier + Refactorer agents in parallel using Auggie SDK")
    .requiredOption("--frd <path>", "Path to FRD markdown")
    .requiredOption("--builder-prompt <path>", "Path to Builder system prompt markdown")
    .requiredOption("--verifier-prompt <path>", "Path to Verifier system prompt markdown")
    .requiredOption("--refactorer-prompt <path>", "Path to Refactorer system prompt markdown")
    .option("--workspace <path>", "Workspace root (defaults to cwd)", process.cwd())
    .option("--model <id>", "Auggie model id (e.g. sonnet4.5)", "sonnet4.5")
    .option("--auggie-path <path>", "Path to auggie executable", "auggie")
    .option("--max-iterations <n>", "Max builder iterations", (v) => Number(v), 80)
    .option("--verifier-interval <sec>", "Seconds between verifier runs", (v) => Number(v), 90)
    .option("--max-turns <n>", "Max turns per Auggie prompt call", (v) => Number(v), 12)
    .option("--allow-unsafe", "Allow any shell command (otherwise allowlist enforced)", false)
    .option("--api-key <key>", "Augment API key (optional; else env/session used)")
    .option("--api-url <url>", "Augment API URL/tenant URL (optional; else env/session used)")
    .parse(process.argv);

  const opts = program.opts<{
    frd: string;
    builderPrompt: string;
    verifierPrompt: string;
    refactorerPrompt: string;
    workspace: string;
    model: string;
    auggiePath: string;
    maxIterations: number;
    verifierInterval: number;
    maxTurns: number;
    allowUnsafe: boolean;
    apiKey?: string;
    apiUrl?: string;
  }>();

  const workspaceRoot = resolve(opts.workspace);
  const frdText = await readFile(resolve(opts.frd), "utf8");
  const builderSystem = await readFile(resolve(opts.builderPrompt), "utf8");
  const verifierSystem = await readFile(resolve(opts.verifierPrompt), "utf8");
  const refactorerSystem = await readFile(resolve(opts.refactorerPrompt), "utf8");

  console.log(pc.bold(pc.cyan("Starting subcalc-agents (3-agent)…")));
  console.log(`Workspace: ${workspaceRoot}`);
  console.log(`Model: ${opts.model}`);
  console.log(`Auggie: ${opts.auggiePath}`);

  await runOrchestrator({
    frdText,
    builderSystemPrompt: builderSystem,
    verifierSystemPrompt: verifierSystem,
    refactorerSystemPrompt: refactorerSystem,
    workspaceRoot,
    model: opts.model,
    auggiePath: opts.auggiePath,
    maxIterations: opts.maxIterations,
    verifierIntervalSec: opts.verifierInterval,
    maxTurns: opts.maxTurns,
    allowUnsafe: opts.allowUnsafe,
    apiKey: opts.apiKey,
    apiUrl: opts.apiUrl
  });

  console.log(pc.bold(pc.green("Done.")));
}
