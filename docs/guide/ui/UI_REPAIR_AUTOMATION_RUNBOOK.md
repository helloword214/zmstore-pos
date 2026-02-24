# UI Repair Automation Runbook

Status: ACTIVE  
Owner: POS Platform  
Last Reviewed: 2026-02-24

## 1. Purpose

Define the repair flow that responds to monitor incidents from `ui:cycle`.
This runbook covers fix execution. It does not replace monitor cadence.
Default repair action is route/component UI refactor patching. Rerun-only is not considered a repair.

## 2. Trigger Conditions

Start repair flow only when at least one is true:

1. Latest monitor incident has `PRIMARY` mismatch classification.
2. Repeated `SECONDARY` mismatch needs cleanup.
3. User explicitly requests UI repair for a reported incident.

Required input before patching:

1. Incident file path (`docs/automation/incidents/<stamp>.md`)
2. Linked summary file path (`docs/automation/runs/<stamp>/summary.md`)
3. Source-of-truth decision:
   - patch route/component code, or
   - refresh baseline snapshots after design approval

## 2.1 Failure-to-Route Mapping (Execution Input)

Use this mapping to select route targets during repair:

1. `tests/ui/rider.golden-reference.spec.ts` rider dashboard mismatch -> `app/routes/rider._index.tsx`
2. `tests/ui/cashier.golden-reference.spec.ts` cashier dashboard mismatch -> `app/routes/cashier._index.tsx`
3. `tests/ui/cashier.golden-reference.spec.ts` cashier shift console mismatch -> `app/routes/cashier.shift.tsx`
4. `tests/ui/manager.golden-reference.spec.ts` manager dashboard mismatch -> `app/routes/store._index.tsx`
5. `tests/ui/manager.golden-reference.spec.ts` rider-checkin mismatch -> `app/routes/runs.$id.rider-checkin.tsx`
6. `tests/ui/manager.golden-reference.spec.ts` manager-remit mismatch -> `app/routes/runs.$id.remit.tsx`

## 3. Repair Flow Steps

1. Read incident + summary and confirm failing targets.
2. Reproduce with targeted spec command.
3. Apply minimal route/component UI patch for mismatched target only.
4. If repeated UI shells/patterns are duplicated across routes, extract shared UI component first, then reuse in touched targets.
5. Re-run targeted specs for changed target.
6. Re-run `npm run ui:cycle` for full regression check.
7. Open PR from `codex/<task-name>` to `main` with trace sections.

Forbidden as final outcome:

1. rerun-only with zero route/component change while mismatch persists
2. snapshot refresh without explicit source-of-truth approval note

## 4. Safety Rules

1. Never combine monitor and repair intents in one automation run.
2. Never commit directly to `main`.
3. Never auto-refresh baselines without explicit design-source confirmation.
4. Keep fix scope limited to reported targets first.
5. Document residual failures if unrelated mismatches remain.
6. Preserve business logic; UI/UX structure/token/component changes only.

## 5. Output Contract

Every repair run should publish:

1. Files changed (repo-relative)
2. Validation commands run
3. Before/after behavior note
4. PR link (if created)
5. Remaining risks or follow-up items

## 6. Escalation

1. If `PRIMARY` mismatch persists for 2 consecutive repair attempts, escalate as `P1_UI_BLOCKER`.
2. If failure is infra-related, hand back to monitor/infra path and stop code edits.
