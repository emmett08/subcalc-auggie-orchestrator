import { tool } from "ai";
import { z } from "zod";
import { execa } from "execa";
import fg from "fast-glob";
import { readFile, writeFile, mkdir, stat, rm } from "node:fs/promises";
import { resolve, relative } from "node:path";
import type { AsyncLock } from "./mutex.js";

type ToolOpts = {
  workspaceRoot: string;
  allowUnsafe: boolean;
  lock: AsyncLock;
};

function safePath(workspaceRoot: string, userPath: string): string {
  const abs = resolve(workspaceRoot, userPath);
  const rel = relative(workspaceRoot, abs);
  if (rel.startsWith("..") || rel.includes("..")) {
    throw new Error(`Path escapes workspaceRoot: ${userPath}`);
  }
  return abs;
}

function commandAllowed(cmd: string, allowUnsafe: boolean): boolean {
  if (allowUnsafe) return true;
  const allowed = [
    "pnpm",
    "npm",
    "yarn",
    "node",
    "npx",
    "git",
    "tsx",
    "tsc",
    "vitest",
    "jest",
    "eslint",
    "storybook",
    "build-storybook"
  ];
  const first = cmd.trim().split(/\s+/)[0] ?? "";
  return allowed.includes(first);
}

export function createBuilderTools(opts: ToolOpts) {
  return createCommonTools({ ...opts, mode: "builder" as const });
}

export function createRefactorerTools(opts: ToolOpts) {
  // Refactorer can write, but should not delete unless explicitly needed.
  return createCommonTools({ ...opts, mode: "refactorer" as const });
}

export function createVerifierTools(opts: ToolOpts) {
  // Verifier is read-only: omit write/delete tools by design.
  const all = createCommonTools({ ...opts, mode: "verifier" as const });
  const { fs_write, fs_delete, fs_apply_edits, fs_mkdir, ...rest } = all;
  return rest;
}

function createCommonTools(opts: ToolOpts & { mode: "builder" | "verifier" | "refactorer" }) {
  const fs_read = tool({
    name: "fs_read",
    description: "Read a text file within the workspaceRoot",
    inputSchema: z.object({
      path: z.string().describe("Path relative to workspaceRoot"),
      maxBytes: z.number().int().positive().optional().describe("Max bytes to read (default 200k)")
    }),
    execute: async ({ path, maxBytes }) => {
      return await opts.lock.runExclusive(async () => {
        const abs = safePath(opts.workspaceRoot, path);
        const buf = await readFile(abs);
        const limit = maxBytes ?? 200_000;
        const sliced = buf.length > limit ? buf.subarray(0, limit) : buf;
        return { path, bytes: buf.length, truncated: buf.length > limit, contents: sliced.toString("utf8") };
      });
    }
  });

  const fs_write = tool({
    name: "fs_write",
    description: "Write a text file within the workspaceRoot (builder/refactorer)",
    inputSchema: z.object({
      path: z.string(),
      contents: z.string(),
      mkdirp: z.boolean().optional().describe("Create parent dirs if missing")
    }),
    execute: async ({ path, contents, mkdirp }) => {
      if (opts.mode === "verifier") throw new Error("fs_write not available to verifier");
      return await opts.lock.runExclusive(async () => {
        const abs = safePath(opts.workspaceRoot, path);
        if (mkdirp) {
          const dir = abs.split("/").slice(0, -1).join("/");
          if (dir) await mkdir(dir, { recursive: true });
        }
        await writeFile(abs, contents, "utf8");
        return { ok: true, path };
      });
    }
  });

  const fs_apply_edits = tool({
    name: "fs_apply_edits",
    description: "Apply line-based edits to a text file (builder/refactorer)",
    inputSchema: z.object({
      path: z.string(),
      edits: z.array(
        z.object({
          startLine: z.number().int().min(1),
          endLine: z.number().int().min(1),
          replacement: z.string()
        })
      )
    }),
    execute: async ({ path, edits }) => {
      if (opts.mode === "verifier") throw new Error("fs_apply_edits not available to verifier");
      return await opts.lock.runExclusive(async () => {
        const abs = safePath(opts.workspaceRoot, path);
        const src = await readFile(abs, "utf8");
        const lines = src.split("\n");
        const sorted = [...edits].sort((a, b) => b.startLine - a.startLine);
        for (const e of sorted) {
          const s = e.startLine - 1;
          const t = e.endLine;
          lines.splice(s, t - s, ...e.replacement.split("\n"));
        }
        await writeFile(abs, lines.join("\n"), "utf8");
        return { ok: true, path, editsApplied: edits.length };
      });
    }
  });

  const fs_delete = tool({
    name: "fs_delete",
    description: "Delete a file or directory within workspaceRoot (builder only by default; refactorer allowed but discouraged)",
    inputSchema: z.object({
      path: z.string()
    }),
    execute: async ({ path }) => {
      if (opts.mode === "verifier") throw new Error("fs_delete not available to verifier");
      // allow refactorer deletes but keep it explicit in prompts; tool doesn't enforce.
      return await opts.lock.runExclusive(async () => {
        const abs = safePath(opts.workspaceRoot, path);
        await rm(abs, { recursive: true, force: true });
        return { ok: true, path };
      });
    }
  });

  const fs_mkdir = tool({
    name: "fs_mkdir",
    description: "Create a directory within workspaceRoot (builder/refactorer)",
    inputSchema: z.object({
      path: z.string()
    }),
    execute: async ({ path }) => {
      if (opts.mode === "verifier") throw new Error("fs_mkdir not available to verifier");
      return await opts.lock.runExclusive(async () => {
        const abs = safePath(opts.workspaceRoot, path);
        await mkdir(abs, { recursive: true });
        return { ok: true, path };
      });
    }
  });

  const fs_glob = tool({
    name: "fs_glob",
    description: "Glob files within workspaceRoot",
    inputSchema: z.object({
      pattern: z.string().describe("Glob pattern, e.g. 'src/**/*.ts'"),
      ignore: z.array(z.string()).optional()
    }),
    execute: async ({ pattern, ignore }) => {
      return await opts.lock.runExclusive(async () => {
        const entries = await fg(pattern, {
          cwd: opts.workspaceRoot,
          ignore: ignore ?? ["**/node_modules/**", "**/dist/**", "**/.git/**"]
        });
        return { pattern, count: entries.length, entries };
      });
    }
  });

  const fs_stat = tool({
    name: "fs_stat",
    description: "Stat a path within workspaceRoot",
    inputSchema: z.object({
      path: z.string()
    }),
    execute: async ({ path }) => {
      return await opts.lock.runExclusive(async () => {
        const abs = safePath(opts.workspaceRoot, path);
        const s = await stat(abs);
        return { path, isFile: s.isFile(), isDir: s.isDirectory(), size: s.size, mtimeMs: s.mtimeMs };
      });
    }
  });

  const cmd_run = tool({
    name: "cmd_run",
    description: "Run a shell command in workspaceRoot (allowlist enforced unless --allow-unsafe)",
    inputSchema: z.object({
      cmd: z.string().describe("Command line to run, e.g. 'pnpm test'"),
      timeoutMs: z.number().int().positive().optional().describe("Timeout (default 10 minutes)")
    }),
    execute: async ({ cmd, timeoutMs }) => {
      return await opts.lock.runExclusive(async () => {
        if (!commandAllowed(cmd, opts.allowUnsafe)) {
          throw new Error(`Command blocked by allowlist: ${cmd}`);
        }
        const r = await execa(cmd, {
          cwd: opts.workspaceRoot,
          shell: true,
          timeout: timeoutMs ?? 10 * 60 * 1000,
          reject: false
        });
        return { cmd, exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr };
      });
    }
  });

  return {
    fs_read,
    fs_write,
    fs_apply_edits,
    fs_delete,
    fs_mkdir,
    fs_glob,
    fs_stat,
    cmd_run
  };
}
