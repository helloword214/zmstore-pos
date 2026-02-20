# Project Governance Entry Point

This file is the permanent governance entry point for this repository.

## Canonical Governance Documents

1. `/Users/johnmichaell.benito/Desktop/client project/zmstore-pos-2/docs/Governance SOP/AI Governance SOP.md`
2. `/Users/johnmichaell.benito/Desktop/client project/zmstore-pos-2/docs/Chat Operating Rules/Chat Execution Rules.md`
3. `/Users/johnmichaell.benito/Desktop/client project/zmstore-pos-2/docs/guide/Commercial Clearance System V2`

If any instruction conflicts, follow this precedence:

1. `Chat Execution Rules.md`
2. `AI Governance SOP.md`
3. `Commercial Clearance System V2`
4. Other project docs

## Intent Modes

1. `DISCUSSION` or `REVIEW`: read-only. No file edits.
2. `PATCH`: edits are allowed only after explicit user approval: `GO`.

## Edit Gate (Mandatory)

Before any edit, provide:

1. Files to be changed
2. Exact planned change

Then wait for explicit `GO`.

## Branch Policy

1. Never commit directly to `main`.
2. Use feature branches only: `codex/<task-name>`.
3. Same objective uses the same branch.
4. Different objective requires a new branch.

## Commit and Save Points

1. One logical task equals one commit.
2. Commit after minimal verification (build/test if available).
3. Show a short diff summary before commit.
4. Assistant should propose the commit title.
5. Commit title format: `type(scope): summary`.

## PR and Merge Policy

1. Create PR from `codex/<task-name>` to `main`.
2. Preferred merge mode: squash and merge, unless local `main` already contains the exact same commits (use merge commit in that case).
3. Delete feature branch after successful merge (local and remote).

## Git and GitHub Coaching Defaults

1. When giving git/github commands, always explain what the command does and why it is used.
2. Prefer plain commands (no `git -C ...`) unless directory override is explicitly needed.
3. Before recommending PR/merge, verify and report:
   a. current branch
   b. `git status -sb`
   c. ahead/behind against `origin/main`
   d. commits in `origin/main..HEAD`
4. If commits were accidentally made on `main`, create a feature branch from current HEAD before opening PR.
5. After merge, always provide post-merge cleanup commands (sync `main`, delete local branch, delete remote branch).

## Automation Preference (User-Approved)

1. Once the user provides explicit `GO`, routine Git/GitHub workflow commands should run without repeated confirmation prompts in the same session.
2. Routine workflow includes: status/check commands, fetch/pull, add/commit/push, and GitHub PR operations (`gh pr status/view/create/merge`).
3. Establish and reuse approved command prefixes early so succeeding turns can proceed end-to-end with minimal friction.
4. Continue reporting what was executed and the outcome, but do not repeatedly ask for permission for the same approved workflow category.
5. Ask again only for high-risk/destructive operations (for example `reset --hard`, history rewrite, destructive deletes) or when authentication/credentials are missing and require user action.

## Path and Privacy Standard

1. In shared docs, PR descriptions, and chat summaries, use repo-relative paths (example: `app/routes/store.clearance_.$caseId.tsx`) or URL routes (example: `/store/clearance/:caseId`).
2. Do not use absolute local machine paths (example: `/Users/...`) in shared documentation or PR text.
3. Absolute paths are allowed only for local terminal execution context, not for project artifacts.

## PR Body Trace Requirement

1. Every PR marked "ready to merge" must contain a well-structured body for traceability.
2. PR body must include:
   a. Summary
   b. Objective/scope
   c. Files touched (repo-relative paths only)
   d. Behavior before vs after
   e. Validation done (commands/tests/manual checks)
   f. Risks/follow-ups
   g. Commit hash(es) included in the PR

## Merge Readiness Checklist

1. Do not recommend merge if PR body trace section is missing or incomplete.
2. Confirm PR body reflects actual final diff before merge.
3. Prefer concise, audit-friendly wording over long narrative.

## Post-Merge Trace Rule

1. After merge, record and report:
   a. PR number
   b. Final merge reference (squash commit hash or merge commit hash)
2. Use these references as canonical trace anchors for future threads.

## Documentation Sync Rule (Mandatory)

1. Any change that affects business behavior must update docs in the same objective/branch.
2. Business behavior includes flow/state transitions, decision gates, route responsibility, and audit/print process changes.
3. Minimum update set for flow changes:
   a. relevant canonical flow guide (`docs/guide/CANONICAL_*.md`)
   b. `docs/guide/DIAGRAMS_DELIVERY_CSS_AR.md` when flow nodes or handoffs change
   c. `docs/guide/README.md` when guide authority/mapping changes
4. Before PR/merge recommendation, assistant must report `Docs Impact`:
   a. files updated, or
   b. `none` with one-line reason.

## Change Safety

1. No silent assumptions. Ask one focused question if unclear.
2. No silent renames or migrations; explain and ask approval first.
3. Avoid broad refactors unless explicitly requested.
