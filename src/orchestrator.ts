import pc from "picocolors";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Auggie } from "@augmentcode/auggie-sdk";
import { createBuilderTools, createRefactorerTools, createVerifierTools } from "./tools/tools.js";
import { mutex } from "./tools/mutex.js";
import { extractTaggedJson } from "./util/extractTaggedJson.js";

type AuggieCreateOpts = NonNullable<Parameters<typeof Auggie.create>[0]>;
export type AuggieModel = NonNullable<AuggieCreateOpts["model"]>;

type OrchestratorOpts = {
  frdText: string;
  builderSystemPrompt: string;
  verifierSystemPrompt: string;
  refactorerSystemPrompt: string;
  workspaceRoot: string;
  model: AuggieModel;
  auggiePath: string;
  maxIterations: number;
  verifierIntervalSec: number;
  maxTurns: number;
  allowUnsafe: boolean;
  apiKey?: string | undefined;
  apiUrl?: string | undefined;
};

type VerifierVerdict = "UNKNOWN" | "PASS" | "FAIL";

type SharedState = {
  startedAt: string;
  iteration: number;

  builder: {
    lastReport?: unknown;
    exitCriteriaMet: boolean;
    wantsRefactor: boolean;
  };

  verifier: {
    lastReport?: unknown;
    verdict: VerifierVerdict;
    blockers?: Array<{ ids?: string[]; summary?: string; fix?: string }>;
    refactorRecommended: boolean;
  };

  refactorer: {
    lastReport?: unknown;
    ranCount: number;
    lastRanAt?: string;
  };
};

const STATE_PATH = ".agent/state.json";

// Heuristic: trigger refactorer if verifier explicitly recommends OR blockers mention these signals
const REFACTOR_SIGNALS = [
  "refactor",
  "solid",
  "architecture",
  "layering",
  "hexagonal",
  "duplication",
  "dead code",
  "cyclomatic",
  "complexity",
  "performance",
  "hot path",
  "testability"
] as const;

export async function runOrchestrator(opts: OrchestratorOpts): Promise<void> {
  await mkdir(resolve(opts.workspaceRoot, ".agent"), { recursive: true });

  const state: SharedState = {
    startedAt: new Date().toISOString(),
    iteration: 0,
    builder: { exitCriteriaMet: false, wantsRefactor: false },
    verifier: { verdict: "UNKNOWN", refactorRecommended: false },
    refactorer: { ranCount: 0 }
  };

  await persistState(opts.workspaceRoot, state);

  const builderTools = createBuilderTools({
    workspaceRoot: opts.workspaceRoot,
    allowUnsafe: opts.allowUnsafe,
    lock: mutex
  });

  const refactorerTools = createRefactorerTools({
    workspaceRoot: opts.workspaceRoot,
    allowUnsafe: opts.allowUnsafe,
    lock: mutex
  });

  const verifierTools = createVerifierTools({
    workspaceRoot: opts.workspaceRoot,
    allowUnsafe: opts.allowUnsafe,
    lock: mutex
  });

  const commonCreate: AuggieCreateOpts = {
    auggiePath: opts.auggiePath,
    workspaceRoot: opts.workspaceRoot,
    model: opts.model,
    allowIndexing: true,
    cliArgs: [`--max-turns=${opts.maxTurns}`],
    ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
    ...(opts.apiUrl !== undefined ? { apiUrl: opts.apiUrl } : {})
  };

  const builderClient = await Auggie.create({ ...commonCreate, tools: builderTools });
  const verifierClient = await Auggie.create({ ...commonCreate, tools: verifierTools });
  const refactorerClient = await Auggie.create({ ...commonCreate, tools: refactorerTools });

  wireStreaming(builderClient, "builder");
  wireStreaming(verifierClient, "verifier");
  wireStreaming(refactorerClient, "refactorer");

  const abort = new AbortController();

  // A small helper so the refactorer can be triggered "immediately" but never concurrently
  let refactorTriggerRequested = false;

  const builderLoop = (async () => {
    while (!abort.signal.aborted && state.iteration < opts.maxIterations) {
      state.iteration += 1;
      await persistState(opts.workspaceRoot, state);

      console.log(pc.bold(pc.cyan(`\n[builder] Iteration ${state.iteration} starting…`)));

      const prompt = buildBuilderPrompt({
        system: opts.builderSystemPrompt,
        frd: opts.frdText,
        workspaceRoot: opts.workspaceRoot,
        state
      });

      const response = await builderClient.prompt(prompt, { isAnswerOnly: true });
      const report = extractTaggedJson(response, "BUILDER_REPORT_JSON");

      state.builder.lastReport = report ?? response;
      state.builder.exitCriteriaMet = Boolean((report as any)?.exitCriteriaMet ?? false);
      state.builder.wantsRefactor = Boolean((report as any)?.wantsRefactor ?? false);

      if (state.builder.wantsRefactor) refactorTriggerRequested = true;

      await persistState(opts.workspaceRoot, state);

      if (state.builder.exitCriteriaMet && state.verifier.verdict === "PASS") {
        abort.abort();
        break;
      }

      // Nudge: if verifier has blockers that look refactor-y, request refactor
      if (state.verifier.verdict === "FAIL" && state.verifier.refactorRecommended) {
        refactorTriggerRequested = true;
      }
    }
  })();

  const verifierLoop = (async () => {
    while (!abort.signal.aborted) {
      console.log(pc.bold(pc.magenta(`\n[verifier] Verification run starting…`)));

      const prompt = buildVerifierPrompt({
        system: opts.verifierSystemPrompt,
        frd: opts.frdText,
        workspaceRoot: opts.workspaceRoot,
        state
      });

      const response = await verifierClient.prompt(prompt, { isAnswerOnly: true });
      const report = extractTaggedJson(response, "VERIFIER_REPORT_JSON");

      state.verifier.lastReport = report ?? response;
      const verdict = (report as any)?.verdict as "PASS" | "FAIL" | undefined;
      state.verifier.verdict = verdict ?? "UNKNOWN";
      state.verifier.blockers = (report as any)?.blockers ?? [];
      state.verifier.refactorRecommended = Boolean((report as any)?.refactorRecommended ?? false) || looksLikeRefactor(state.verifier.blockers);

      await persistState(opts.workspaceRoot, state);

      if (state.verifier.verdict === "PASS" && state.builder.exitCriteriaMet) {
        abort.abort();
        break;
      }

      // If verifier fails and refactor is recommended, trigger refactorer promptly
      if (state.verifier.verdict === "FAIL" && state.verifier.refactorRecommended) {
        refactorTriggerRequested = true;
      }

      // Sleep, but can be interrupted by abort
      await sleep(opts.verifierIntervalSec * 1000, abort.signal);
    }
  })();

  const refactorerLoop = (async () => {
    while (!abort.signal.aborted) {
      if (!refactorTriggerRequested) {
        await sleep(1000, abort.signal);
        continue;
      }
      refactorTriggerRequested = false;

      // Only refactor when verifier isn't PASS yet (otherwise it's a no-op risk)
      if (state.verifier.verdict === "PASS") continue;

      console.log(pc.bold(pc.yellow(`\n[refactorer] Triggered (verifier FAIL / builder request)…`)));

      const prompt = buildRefactorerPrompt({
        system: opts.refactorerSystemPrompt,
        frd: opts.frdText,
        workspaceRoot: opts.workspaceRoot,
        state
      });

      const response = await refactorerClient.prompt(prompt, { isAnswerOnly: true });
      const report = extractTaggedJson(response, "REFACTORER_REPORT_JSON");

      state.refactorer.lastReport = report ?? response;
      state.refactorer.ranCount += 1;
      state.refactorer.lastRanAt = new Date().toISOString();

      // After refactor, force a verifier run sooner by flipping its interval behaviour:
      // simplest: just request another refactor if builder asked; otherwise wait for verifier loop tick.
      await persistState(opts.workspaceRoot, state);
    }
  })();

  await Promise.allSettled([builderLoop, verifierLoop, refactorerLoop]);

  await builderClient.close();
  await verifierClient.close();
  await refactorerClient.close();

  console.log(pc.bold(pc.green("\nFinal verdict:")), state.verifier.verdict);
  console.log(pc.bold(pc.green("Exit criteria met:")), String(state.builder.exitCriteriaMet));
  console.log(pc.dim(`State file: ${resolve(opts.workspaceRoot, STATE_PATH)}`));
}

function looksLikeRefactor(blockers?: Array<{ summary?: string; fix?: string }>): boolean {
  const txt = JSON.stringify(blockers ?? []).toLowerCase();
  return REFACTOR_SIGNALS.some((s) => txt.includes(s));
}

function wireStreaming(client: any, label: "builder" | "verifier" | "refactorer") {
  client.onSessionUpdate((event: any) => {
    const u = event.update;
    switch (u.sessionUpdate) {
      case "agent_message_chunk":
        if (u.content?.type === "text") {
          process.stdout.write(pc.dim(`[${label}] `) + u.content.text);
        }
        break;
      case "tool_call":
        process.stdout.write("\n" + pc.dim(`[${label}] tool_call: `) + pc.yellow(String(u.title ?? "")) + "\n");
        break;
      case "tool_call_update":
        process.stdout.write(pc.dim(`[${label}] tool_output: `) + String(u.rawOutput ?? "") + "\n");
        break;
    }
  });
}

async function persistState(workspaceRoot: string, state: SharedState) {
  await writeFile(resolve(workspaceRoot, STATE_PATH), JSON.stringify(state, null, 2), "utf8");
}

function buildBuilderPrompt(args: { system: string; frd: string; workspaceRoot: string; state: SharedState }): string {
  return [
    args.system,
    "",
    "## Workspace",
    `- workspaceRoot: ${args.workspaceRoot}`,
    "",
    "## FRD (authoritative)",
    args.frd,
    "",
    "## Shared state (coordination)",
    "```json",
    JSON.stringify(args.state, null, 2),
    "```",
    "",
    "## Output contract (MUST comply)",
    "At the end of your response, output EXACTLY one JSON object inside these tags:",
    "<<<BUILDER_REPORT_JSON>>>",
    "{",
    '  "exitCriteriaMet": boolean,',
    '  "wantsRefactor": boolean,',
    '  "completed": string[],',
    '  "next": string[],',
    '  "commandsRun": { "cmd": string, "exitCode": number }[],',
    '  "notes": string',
    "}",
    "<<<END>>>",
    "",
    "Rules:",
    "- Implement + test + verify features; keep going until exitCriteriaMet true.",
    "- If you detect refactoring opportunities (SOLID, layering, duplication, performance), set wantsRefactor=true and describe them in notes.",
    "- Use tools to edit files and run checks."
  ].join("\n");
}

function buildVerifierPrompt(args: { system: string; frd: string; workspaceRoot: string; state: SharedState }): string {
  return [
    args.system,
    "",
    "## Workspace",
    `- workspaceRoot: ${args.workspaceRoot}`,
    "",
    "## FRD (authoritative)",
    args.frd,
    "",
    "## Shared state (context)",
    "```json",
    JSON.stringify(args.state, null, 2),
    "```",
    "",
    "## Output contract (MUST comply)",
    "At the end of your response, output EXACTLY one JSON object inside these tags:",
    "<<<VERIFIER_REPORT_JSON>>>",
    "{",
    '  "verdict": "PASS" | "FAIL",',
    '  "refactorRecommended": boolean,',
    '  "blockers": Array<{ ids: string[], summary: string, fix: string }>,',
    '  "commands": Array<{ cmd: string, exitCode: number }>,',
    '  "coverage": { frPassed: number, frTotal: number, ucPassed: number, ucTotal: number }',
    "}",
    "<<<END>>>",
    "",
    "Be strict: FAIL unless you can prove compliance with tests + traceability."
  ].join("\n");
}

function buildRefactorerPrompt(args: { system: string; frd: string; workspaceRoot: string; state: SharedState }): string {
  return [
    args.system,
    "",
    "## Workspace",
    `- workspaceRoot: ${args.workspaceRoot}`,
    "",
    "## FRD (context, do not add new features unless necessary for refactor correctness/testability)",
    args.frd,
    "",
    "## Shared state (focus on verifier blockers / builder notes)",
    "```json",
    JSON.stringify(args.state, null, 2),
    "```",
    "",
    "## Output contract (MUST comply)",
    "At the end of your response, output EXACTLY one JSON object inside these tags:",
    "<<<REFACTORER_REPORT_JSON>>>",
    "{",
    '  "refactorsApplied": string[],',
    '  "commandsRun": { "cmd": string, "exitCode": number }[],',
    '  "notes": string',
    "}",
    "<<<END>>>",
    "",
    "Rules:",
    "- You are an optimiser/refactorer. Improve SOLID, layering, testability, and performance.",
    "- Do not implement new FRD features unless strictly required to complete a refactor safely.",
    "- Keep the repository green: run checks after refactors and fix failures."
  ].join("\n");
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(), ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });
}
