# Documentation Architecture Standard

Version: 1.0
Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-13

## Purpose

Define one repository-level standard for how documentation is structured, owned, linked, and maintained so rules stay discoverable and do not fragment across unrelated files.

## Core Rules

1. Documentation is a primary system artifact alongside code.
2. One concern or rule must have one owner document.
3. Cross-reference is preferred over duplication.
4. Unrelated concerns must not be merged into one document just because they are convenient to place together.
5. Reader navigation must be intentional: router docs route, canonical docs decide, diagrams visualize.

## Concern Ownership Rule

Each important concern must have one owner document.

Examples:

1. cashier shift lifecycle -> cashier shift canonical flow doc
2. upload/storage contract -> upload/storage SoT doc
3. worker scheduling and duty sessions -> worker scheduling canonical doc once approved

Owner document responsibilities:

1. define the binding rules for that concern
2. define route or module responsibility where relevant
3. define boundary lines with adjacent concerns
4. serve as the first reference target from other docs

Secondary docs must not become competing owner docs.

## Document Types and Their Jobs

### 1. Canonical Docs

Canonical docs are the binding source for one concern.

Canonical docs should own:

1. business rules
2. state machines
3. decision gates
4. route or module responsibility
5. required audit rules

Canonical docs should not:

1. absorb unrelated UI guidance
2. absorb unrelated storage rules
3. absorb unrelated staffing, payroll, or identity rules unless they truly own them

### 2. Router Docs

Router docs include guide indexes and readme-style navigation docs.

Router docs should:

1. tell the reader where authority lives
2. summarize doc purpose at a high level
3. point to the owner document

Router docs must not:

1. become secondary specs
2. restate full binding rule sets
3. introduce new business rules

### 3. Diagram Docs

Diagram docs should:

1. visualize flows
2. show handoffs and ownership boundaries
3. point back to owner docs for binding interpretation

Diagram docs must not:

1. become alternate canonical rule sources
2. introduce rule text that conflicts with canonical docs

### 4. Supporting Docs

Supporting docs may:

1. explain rationale
2. provide implementation notes
3. assist UI or repair workflow

Supporting docs must not silently override canonical rules.

### 5. Draft Docs

Draft docs may:

1. propose future direction
2. capture in-progress thinking
3. preserve pending decisions

Draft docs must:

1. clearly mark themselves as draft
2. state that they do not override canonical docs until promoted

## Cross-Reference Rule

When a concern belongs to another document:

1. summarize only what is necessary for local context
2. explicitly point to the owner document
3. do not duplicate the entire rule set

Preferred pattern:

1. `Refer to: <owner doc>`
2. one-line reason for the reference if needed

## Mixed Concern Rule

Do not combine unrelated concerns in a single document unless the document explicitly owns all of them.

Examples of concerns that should usually be separated:

1. business flow authority
2. upload/storage behavior
3. UI styling and conformance
4. staffing/schedule planning
5. audit attachment/storage mechanics

If a patch would mix unrelated concerns:

1. split the docs, or
2. keep one owner doc and point to related owner docs

## Canonical Doc Boundary Sections

New or substantially revised canonical docs should explicitly declare boundary sections.

Recommended minimum structure:

1. `Purpose`
2. `Scope`
3. `Owns`
4. `Does Not Own`
5. `Refer To`

Equivalent wording is acceptable if the boundary is still explicit.

## Documentation Patch Workflow

Before changing docs for a feature or rule:

1. identify the concern
2. identify the owner document
3. identify which secondary docs need alignment or reference updates

When patching docs:

1. update owner doc first
2. update diagrams only for flow/handoff visibility
3. update router docs only for discoverability and authority mapping
4. update supporting or draft docs only when they need to explain or preserve context

Before merge or ship:

1. report `Docs Impact`
2. state which doc is the owner doc for the change
3. confirm that no competing rule source was introduced

## Conflict Rule

If two docs appear to define the same rule:

1. prefer the declared owner document
2. if ownership is unclear, stop and resolve ownership before expanding the docs further
3. remove duplicate rule detail from secondary docs in the next cleanup objective

## Relationship to Existing Governance

Execution behavior is enforced by:

1. `docs/Chat Operating Rules/Chat Execution Rules.md`

Repo entry-point summary is enforced by:

1. `AGENTS.md`

Governance rationale and evolution remain in:

1. `docs/Governance SOP/AI Governance SOP.md`
