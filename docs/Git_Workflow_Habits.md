### Git Workflow & Habits

Make progress obvious in git log, keep history clean, and tie code to docs.

Goals

- Small, reviewable commits that tell a story.

Branch names and commit messages that map to product areas.

Docs updated alongside code so history reflects business decisions .

Branching

Format: type/scope-short-desc

type: feat, fix, refactor, perf, docs, chore

scope: kiosk, slip, cashier, inventory, db, ui

example: feat/kiosk-mixed-modes, fix/slip-expiry-badge

git switch -c feat/kiosk-mixed-modes # create & switch to a feature branch

Commit Style (Conventional Commits)

Format: type(scope): summary

Body (optional): why + key details

Footer (optional): references, breaking changes

Examples:

feat(kiosk): allow mixed retail+pack lines in one cart
fix(slip): set printedAt on reprint and keep expiry unchanged
docs(pos): add API_Slip.md for /orders/new contract
chore(build): add husky pre-commit for lint+typecheck

Guidelines

One logical change per commit.

Keep subject ≤ 72 chars, imperative (“add”, “fix”, “update”).

If you touch behavior, touch docs in the same PR.

git add app/routes/kiosk.\_index.tsx # stage code
git add docs/POS_KioskUI.md docs/API_Slip.md # stage related docs
git commit -m "feat(kiosk): add Code39 to slip page and mixed-mode add buttons"

Daily Flow (Short)
git fetch origin # update remote refs
git switch -c feat/kiosk-barcode # start a branch

# ... code ...

git add -A # stage all changes
git commit -m "feat(slip): render Code39 under order code"
git push -u origin feat/kiosk-barcode # first push with upstream

Bringing Main Into Your Branch

Merge (keeps full history)

git fetch origin # refresh remote branches
git merge origin/main # merge main into current branch

Rebase (linear history)

git fetch origin # refresh remote branches
git rebase origin/main # replay your commits on top of main
git push --force-with-lease # update remote safely after rebase

“Feature Done” Ritual (Checklist)

Green checks locally

Run lint & typecheck:

npm run lint && npm run typecheck # ensure clean before commit

Update docs

Touch the relevant files for behavior you changed:

docs/POS_BusinessPlan.md

docs/POS_OrderFlow.md

docs/POS_KioskUI.md

docs/API_Slip.md

docs/POS_ChangeLog.md → add under Unreleased

Write meaningful commits

git add -A
git commit -m "feat(kiosk): mixed retail+pack add; disable per-mode with stock/price"
git commit -m "docs(pos): update API_Slip contract and kiosk UI acceptance"

Rebase/merge main

git fetch origin
git rebase origin/main # or: git merge origin/main

Push & open PR

git push --force-with-lease # only if you rebased

PR Description Template

What: 1–3 bullet summary.

Why: user/business impact.

How: key technical notes (modes, stock semantics).

Docs: list files you updated.

Testing: steps / screenshots.

Merge strategy

Prefer Squash & merge → PR title becomes a clean single commit on main.

Tag (optional, per release)

git switch main && git pull
git tag -a v0.2.0 -m "Kiosk mixed-mode + slip barcode"
git push origin v0.2.0

Changelog Discipline

Use Keep a Changelog style in docs/POS_ChangeLog.md:

## [Unreleased]

### Added

- Kiosk: Mixed retail+pack add buttons with per-mode validation.
- Slip: Code39 barcode under Order Code; reprint increments counter.

### Fixed

- Slip: expiry no longer resets on reprint.

### Changed

- Stock semantics: `stock`=packs, `packingStock`=retail units.

When you cut a release/tag, move Unreleased to [vX.Y.Z] and open a fresh Unreleased block.

Useful Commands (with explanations)
git status # what changed (staged/unstaged/untracked)
git diff # see unstaged changes
git diff --staged # see staged changes vs last commit
git log --oneline --graph --decorate --all # pretty history graph

git restore --staged <file> # unstage but keep local edits
git restore <file> # discard local edits in the file

git commit --amend # edit last commit (message or staged files)
git revert <hash> # create a new commit that undoes <hash>

git stash # shelve dirty work
git switch main # switch branches
git stash pop # re-apply last stash

Optional Tooling (recommended)

Husky pre-commit hook to prevent broken commits:

npx husky-init && npm i

# .husky/pre-commit

npm run lint && npm run typecheck

Git aliases (add to ~/.gitconfig) for readable logs:

[alias]
lg = log --oneline --graph --decorate --all
st = status -sb
co = checkout
sw = switch

Examples From This Repo

feat(kiosk): allow mixed retail+pack items; per-mode disable rules

fix(orders): validate qty vs stock (pack) and packingStock (retail)

feat(slip): render Code39 barcode + reprint counter

docs(api): add API_Slip.md with server validations and examples

chore(ui): modal for server validation errors on slip create

Review Mindset

Does the commit message answer: What changed? Why?

Does the PR show both code and docs for the behavior?

Is the changelog updated so future you understands the release?

TL;DR Habit

Code → Update Docs → Lint/Typecheck → Commit (clean message) → Rebase main → Push → PR (squash) → Tag (optional) → Update Changelog.
