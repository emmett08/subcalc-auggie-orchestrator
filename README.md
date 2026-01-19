# subcalc-auggie-orchestrator (3-agent topology)

Runs three Auggie SDK agents against a workspace/repo:

1. **Builder** (implementation): implements FRD features end-to-end (code + tests + docs).
2. **Verifier** (adversarial QA): read-only; proves compliance via tests + traceability; blocks if not proven.
3. **Refactorer** (optimiser): only refactors/optimises to improve SOLID, layering, testability, performance,
   and removes duplication; must keep all checks green.

The orchestrator runs Builder and Verifier in parallel. When Verifier fails with refactor-related blockers
(or Builder requests refactoring), the orchestrator triggers the Refactorer, then resumes verification.

## Install

Requires Node.js >= 22.13 (beta @mastra/mcp override).

```bash
npm install
npm run build
```

## Run

```bash
subcalc-agents \
  --workspace /Users/emiller/work/code/personal/subnet-tree-calculator \
  --frd /Users/emiller/work/code/personal/subcalc-auggie-orchestrator/FRD-Subnet-Calculator.md \
  --builder-prompt prompts/builder.system.md \
  --verifier-prompt prompts/verifier.system.md \
  --refactorer-prompt prompts/refactorer.system.md \
  --model sonnet4.5
```

### Notes
- Tools are serialised behind a mutex to avoid concurrent file/command races.
- The verifier has no write tools by design.
- The refactorer has write tools but is instructed (system prompt) to avoid feature additions unless strictly
  needed to support refactoring correctness or testability.

## Files
- `.agent/state.json` shared coordination state.
