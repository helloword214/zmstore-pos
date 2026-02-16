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

## Change Safety

1. No silent assumptions. Ask one focused question if unclear.
2. No silent renames or migrations; explain and ask approval first.
3. Avoid broad refactors unless explicitly requested.
