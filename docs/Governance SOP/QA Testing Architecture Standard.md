# QA Testing Architecture Standard

Version: 1.0
Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-19

## Purpose

Define one repository-level standard for how QA and testing artifacts are structured, named, and separated so manual QA, browser automation, and test-data setup remain organized, expandable, and easy to route.

## Scope

This standard applies to:

1. manual QA checklists
2. browser automation such as Playwright specs
3. QA setup and cleanup scripts
4. naming conventions for QA/testing artifacts
5. folder organization for QA/testing assets

## Owns

This document owns:

1. the meaning of QA as a repository concern
2. the boundary between manual QA, browser QA, and data-setup utilities
3. the file-structure standard for QA/testing assets
4. the naming convention for QA/testing files
5. the role of `setup`, `cleanup`, `spec`, and `checklist` artifacts

## Does Not Own

This document does not own:

1. business rules for payroll, scheduling, cashier, delivery, AR, or clearance
2. route behavior or state-machine authority
3. automation runbook contracts for prompt routing or monitoring execution
4. framework-specific code style outside QA/testing artifact structure

## Refer To

1. `docs/Chat Operating Rules/Chat Execution Rules.md` for execution gates and command protocol
2. `docs/Governance SOP/Documentation Architecture Standard.md` for owner-doc and cross-reference doctrine
3. `docs/automation/README.md` and automation runbooks for UI automation execution operations
4. `docs/guide/README.md` and the relevant canonical guide for product behavior under test

## Core Definitions

### QA

QA means the activity of verifying that the app behaves correctly, not merely that code runs.

QA may include:

1. manual browser checks
2. automated browser checks
3. data setup for a test scenario
4. cleanup of QA-generated data
5. result capture such as pass/fail findings or follow-up notes

### Manual QA

Manual QA is human-driven validation of behavior, UX, and flow judgment.

Use manual QA when:

1. the behavior needs human judgment
2. the flow is exploratory
3. a scenario is too new to justify an automated spec yet

### Browser QA

Browser QA means automated interaction with the real app UI, usually through Playwright.

Use browser QA when:

1. the same scenario must be repeated reliably
2. the value comes from checking actual UI behavior
3. the flow should be regression-safe across future changes

Browser QA should prefer accessible selectors first, especially real label-to-control bindings for form fields.

### QA Setup and Cleanup

QA setup prepares a valid scenario for testing.
QA cleanup removes only the scenario data created for that QA objective.

Setup and cleanup do not replace QA. They support QA.

## Responsibility Split

### Checklist Artifacts

Checklist files define:

1. the scenario to verify
2. the user steps to execute
3. the expected outcomes

Checklist files must not redefine business rules. They should point to the owner canonical doc when rule authority is needed.

### Spec Artifacts

Spec files define:

1. repeatable browser assertions
2. automated UI steps
3. regression coverage for a named scenario

Spec files must not become the owner of business behavior.

### Setup Artifacts

Setup files define:

1. how a named QA scenario gets its prerequisite data
2. how that data is tagged or identified
3. what minimum state is needed before manual or automated QA starts

Setup files should prefer real service-layer or Prisma-backed domain paths over ad hoc raw SQL when practical.

### Cleanup Artifacts

Cleanup files define:

1. how to remove only the QA-generated data for a named scenario
2. how to restore a clean local or QA testing state

Cleanup must be narrow and scenario-scoped.

## Folder Architecture Standard

Use domain-scoped folders and scenario-scoped filenames.

Recommended structure:

```text
docs/qa/
  workforce/
    workforce-payroll-happy-path-checklist.md
  cashier/
    cashier-shift-open-close-checklist.md

tests/ui/
  workforce/
    workforce-payroll-happy-path.spec.ts
  cashier/
    cashier-shift-open-close.spec.ts

scripts/qa/
  workforce/
    workforce-payroll-happy-path-setup.ts
    workforce-payroll-happy-path-cleanup.ts
  cashier/
    cashier-shift-open-close-setup.ts
    cashier-shift-open-close-cleanup.ts
```

If a new QA concern is introduced:

1. place it in the correct domain folder first
2. keep the scenario name consistent across setup, cleanup, spec, and checklist
3. do not mix unrelated domains in one generic QA file

## Naming Convention Rule

Use this pattern:

`domain-scenario-purpose`

Examples:

1. `workforce-payroll-happy-path-setup.ts`
2. `workforce-payroll-happy-path-cleanup.ts`
3. `workforce-payroll-happy-path.spec.ts`
4. `workforce-payroll-happy-path-checklist.md`
5. `cashier-shift-open-close.spec.ts`

The purpose suffix must make the role obvious:

1. `setup`
2. `cleanup`
3. `checklist`
4. `.spec`

## Generic Filename Prohibition

Do not use generic QA/testing filenames such as:

1. `test.ts`
2. `setup.ts`
3. `cleanup.ts`
4. `helpers.ts`
5. `common.ts`
6. `playwright.ts`

If a shared QA helper is needed, the filename must still expose domain or scenario context.

Acceptable examples:

1. `workforce-payroll-assertions.ts`
2. `cashier-shift-fixture.ts`
3. `dispatch-run-timeline-helpers.ts`

## Scenario Family Rule

One scenario should read as one family of artifacts.

Example family:

1. `scripts/qa/workforce/workforce-payroll-happy-path-setup.ts`
2. `scripts/qa/workforce/workforce-payroll-happy-path-cleanup.ts`
3. `tests/ui/workforce/workforce-payroll-happy-path.spec.ts`
4. `docs/qa/workforce/workforce-payroll-happy-path-checklist.md`

This keeps expansion predictable and prevents naming collisions later.

## Data Safety Rule

QA setup that mutates data must be traceable and reversible.

Recommended minimum practice:

1. mark QA-created data with a scenario-specific note or marker when the model allows it
2. keep cleanup scoped to that scenario marker
3. avoid broad cleanup commands that could touch unrelated local data

## Choosing the Right QA Mode

Use manual QA when:

1. UX judgment matters most
2. the scenario is still exploratory
3. browser automation would be premature

Use browser QA when:

1. the scenario is stable enough to repeat
2. UI regressions are likely
3. the value comes from verifying real user interactions

## Playwright Execution Rule

For local browser QA in this repo:

1. prefer isolated browser contexts or explicit `storageState` files over attaching to an existing persistent browser session
2. on the local Remix/Vite server, prefer `domcontentloaded` plus explicit locator or URL waits over `networkidle`
3. keep selectors accessibility-first when practical, especially `getByRole()` and `getByLabel()` once the UI exposes real semantics
4. if the flow needs repeated authenticated browser access, prefer a named local QA browser-session helper over repeated OTP log scraping

## Local QA Auth Helper Rule

Local QA auth or browser-session helpers are allowed when they:

1. are scoped to a named QA scenario
2. create session state through the app auth layer or an equivalent repository-owned auth helper
3. stay local-only and do not alter production authentication rules
4. remain separate from business behavior docs and route authority

Use setup and cleanup scripts when:

1. the scenario needs prerequisite data
2. manual data preparation is slow or error-prone
3. the same QA path will be repeated across objectives

## Documentation Routing Rule

When QA/testing docs are added later:

1. this document remains the owner for QA/testing architecture rules
2. scenario checklists under `docs/qa/` are secondary docs only
3. canonical business docs still own the behavior being tested

## Conflict Rule

If a checklist, script note, or spec comment appears to define a rule that conflicts with a canonical business doc:

1. prefer the canonical business owner doc for behavior
2. prefer this QA architecture standard for testing-asset structure and naming
3. update the secondary QA artifact to reference the correct owner doc
