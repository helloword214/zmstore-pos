# QA Scenario Index

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-19

This file is a router for `docs/qa`.
It points readers to QA scenario docs and must not become the owner of QA/testing architecture rules.

## Owns

1. routing readers to scenario-specific QA checklists
2. keeping a discoverable list of current QA scenario docs

## Does Not Own

1. QA/testing architecture rules
2. business behavior under test
3. Playwright execution contracts

## Refer To

1. `docs/Governance SOP/QA Testing Architecture Standard.md`
2. `docs/guide/README.md`
3. the relevant canonical business doc for the flow being tested

## Current Scenario Docs

### Workforce

1. `workforce/workforce-payroll-happy-path-checklist.md`

Use this checklist after running the matching scenario setup command:

1. `npm run qa:workforce:payroll:happy-path:setup`
2. perform the manual QA steps in the checklist
3. `npm run qa:workforce:payroll:happy-path:cleanup`
