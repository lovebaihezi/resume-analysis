---
name: commit
description: "Stage changes, run this repo's PNPM/Cloudflare Workers validation, create Conventional Commits, push branches, open GitHub pull requests with gh, and manage PR checks/auto-merge. Use when a user asks to commit, push, open a PR, enable auto-merge, or shepherd CI checks to green."
---

# Commit

## Overview

Automate the end-to-end git + GitHub CLI flow for this PNPM/Vite/Cloudflare Workers project: branch creation, validation, staging, Conventional Commit message, PR creation, and PR check monitoring/merge prompts.

This repository does not use `just` or `xtask`. Use plain `git`, `gh`, `pnpm`, and Wrangler commands.

## Project Commands

- Install dependencies with `pnpm install --frozen-lockfile` if dependencies are missing.
- Run normal pre-PR validation with `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, and `pnpm run build`.
- Run `pnpm run test:e2e` when UI/page behavior, routing, browser-only behavior, or screenshots are affected.
- Run `pnpm run cf-typegen` after changing Worker bindings, `wrangler.jsonc`, compatibility flags, Durable Objects, AI bindings, assets config, vars, or migrations.
- If changes touch Cloudflare Workers, Durable Objects, Workers AI, Wrangler config, or platform limits, follow `AGENTS.md`: retrieve current Cloudflare docs before editing or diagnosing that area.
- The deploy workflow is `.github/workflows/deploy.yml`; it runs install, Chromium install, lint, typecheck, test, build, and `pnpm exec wrangler deploy` on pushes to `main`.

## Workflow

1. Inspect repo state.
   - Run `git status -sb` and `git branch --show-current`.
   - If there are no changes, ask the user what to commit.

2. Ensure a non-main branch.
   - If current branch is `main`, create a branch with `git switch -c <type>-<short-kebab-summary>`.
   - Use `feat-...` for features, `fix-...` for bug fixes, `chore-...` for repo/tooling work, and `docs-...` for documentation-only work.
   - If the summary is unclear or the user has a preference, ask for a branch name instead of guessing.

3. Validate before committing.
   - Choose commands from Project Commands based on the touched files and risk.
   - For small skill/docs-only changes, validation can be limited to inspecting the changed files and checking git status.
   - Record every command and result for the PR body. If a command is skipped, include the reason.

4. Stage changes.
   - Stage tracked changes with `git add -A`.
   - If there are untracked files that are likely unintended, ask before staging.
   - Do not stage local artifacts such as `node_modules/`, `.wrangler/`, `dist/`, `test-results/`, `.vitest-attachments/`, temporary PR bodies, or screenshots unless the user explicitly asks.

5. Generate a Conventional Commit message.
   - Choose `type` based on change intent: `feat`, `fix`, `refactor`, `docs`, `chore`, etc.
   - Pick `scope` from the most affected area: `worker`, `ui`, `tests`, `config`, `codex`, `docs`, or another clear local area.
   - Write: `<type>(<scope>): <imperative summary>`.
   - If unsure, ask the user to confirm the type/scope.

6. Commit and handle hook failures.
   - Run `git commit -m "<message>"`.
   - If hooks fail due to permissions or sandboxing (e.g., `/dev/ptmx`), re-run the same commit command with escalated permissions instead of bypassing hooks.
   - If hooks fail due to lint/test errors, fix issues, re-stage, and retry.
   - Do not disable or bypass hooks unless the user explicitly approves it.
   - If commit signing fails (GPG), ask the user whether to retry with signing fixed or proceed with `--no-gpg-sign`.

7. Push and create PR.
   - Push with `git push -u origin <branch>` for a new branch, or `git push` for an existing upstream.
   - Fill a PR body from `references/pr-body.md` for every PR. Resolve it relative to this skill directory, copy it to a temporary editable path, replace every `[fill in]`, and include the actual test commands/results.
   - In `Behavior Changes And Limitations`, explicitly describe previous behavior, new behavior, and any user actions/workflows that no longer work or are newly limited. If the PR adds no new limitation, state that.
   - Create the PR with `gh pr create --title "<title>" --body-file <filled-body-path> --base main --head <branch>`.
   - Do not use automatic PR body generation unless the template is missing or the user explicitly asks for it.
   - If PR creation fails due to missing remote branch, push then retry.

8. Ask about auto-merge.
   - After PR creation, ask: "Enable auto-merge?" and only proceed on explicit approval.
   - If approved, run `gh pr merge <pr-url> --auto --squash` unless the repository requires a different merge method.

9. Monitor checks.
   - Use `gh pr checks <pr-url> --watch` to monitor status.
   - If no checks are reported, state that clearly and inspect `gh pr view <pr-url> --json mergeStateStatus,reviewDecision,statusCheckRollup,mergeable` when useful.
   - If checks fail, inspect failures, apply fixes, commit/push, and re-check until green.
   - After checks pass, ask whether to merge if auto-merge is not enabled.

10. Sync with main before merge.
   - If the user requests it, fetch and rebase onto `origin/main` before merging.
   - Force-push with lease after rebase: `git push --force-with-lease`.
   - Re-check PR status after the rebase.

## Resources

### references/
- `references/pr-body.md` provides the required PR body template.
