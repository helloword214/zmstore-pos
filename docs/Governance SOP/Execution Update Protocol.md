# Execution Update Protocol
Version: 1.0  
Purpose: Define how execution updates, patches, and state changes are communicated during an active chat session without re-pasting full code.

---

## 1. Core Principle

### Rule
During execution, the chat tracks **decisions and state**, not full source code.

### Rationale
Repeatedly pasting full files causes version confusion, token exhaustion, and unclear baselines. The source of truth for code lives outside the chat.

---

## 2. Baseline Definition

### Rule
Once a patch is accepted and applied locally, it becomes the **current baseline**.

The baseline is assumed to be correct unless explicitly stated otherwise.

### Rationale
Execution must always reason from a single, agreed-upon state. Multiple implicit versions lead to logic drift.

---

## 3. Patch Proposal Format

### Rule
Patch proposals should be communicated as:
- GitHub-style diffs (preferred), or
- Small, focused code snippets (5–15 lines max)

Full file re-paste is discouraged unless explicitly required.

### Rationale
Diffs and small snippets preserve clarity and minimize cognitive and token overhead.

---

## 4. Patch Decision States (REQUIRED)

Every patch proposal must end in **one explicit state**:

- **Accepted**  
  Patch is correct and applied locally.

- **Accepted with Error**  
  Patch is mostly correct but has a known issue that must be addressed.

- **Rejected**  
  Patch is not applied and must not be assumed.

- **Superseded**  
  Patch is replaced by a newer accepted change.

### Rationale
Explicit state prevents the AI from assuming whether a change is live.

---

## 5. Communication After Acceptance

### Rule
After a patch is accepted:
- Do NOT re-paste the full updated file.
- Communicate changes using:
  - function names
  - line references
  - brief snippets if needed

Example:
> “Accepted. Applied locally. Issue remains in `validateTotals()` around frozen pricing.”

### Rationale
State declarations are more reliable than re-pasting entire files.

---

## 6. When Full File Re-Paste Is Allowed

Full file re-paste is allowed only when:
- Starting a new chat session
- Performing a major refactor
- Conducting a formal review or audit
- Debugging a failure that cannot be reasoned about via diffs

### Rationale
Full visibility is sometimes necessary, but should be intentional and rare.

---

## 7. Handling Errors After Acceptance

### Rule
If an accepted patch is later found incorrect, its state must be updated explicitly.

Example:
- “Previous patch is superseded due to incorrect null handling.”

### Rationale
Execution state must reflect reality, not historical intent.

---

## 8. Assumption Reset

### Rule
Rejected or superseded patches must be treated as **non-existent** for future reasoning.

### Rationale
Dead patches must not leak into future logic.

---

## 9. Relationship to Other Documents

This protocol operates under:
- `AI Governance SOP.md`
- `Chat Execution Rules.md`

It does not override governance or chat behavior rules.

---

End of Document.
