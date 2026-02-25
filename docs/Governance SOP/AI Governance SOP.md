# AI Governance SOP — Evolution & Improvement Guide

Version: 1.0  
Purpose: Guide for safely evolving the AI Governance SOP based on real project observations.

---

## 1. Core Principle

### Rule

The AI Governance SOP must evolve only from **observed failure patterns**, not hypothetical improvements.

### Rationale

Enterprise governance improves through evidence. Rules created without real incidents increase complexity without reducing risk.

---

## 2. What to Observe During Real Work

### 2.1 Silent Assumption Incidents

**Signal:**

- AI assumed intent, scope, file, or logic without confirmation.

**Action:**

- Identify which rule failed to block the assumption.
- Tighten or clarify that rule.
- Do not add new rules unless the same issue repeats.

---

### 2.2 Intent Mismatch Corrections

**Signal:**

- You respond with: “Hindi yan”, “Iba yung ibig ko sabihin”, or “Bakit napunta dyan?”

**Action:**

- Determine if the intent labeling was too vague.
- Improve intent declaration clarity, not execution rules.

---

### 2.3 Question Fatigue

**Signal:**

- Repeated clarifying questions about the same unknown area.

**Action:**

- Convert repeated questions into an explicit **Unknown Boundary Rule**.
- Prefer declared ignorance over repeated questioning.

---

### 2.4 Scope Creep

**Signal:**

- The conversation expands into new modules, flows, or files without explicit permission.

**Action:**

- Strengthen scope freeze language in governance.
- Require explicit scope expansion approval.

---

### 2.5 Excessive Friction

**Signal:**

- Governance feels unnecessarily slow or blocking low-risk work.

**Action:**

- Introduce or clarify **explicit override rules**.
- Do not weaken default safety behavior.

---

## 3. When to Upgrade the SOP

### Rule

Upgrade governance only when a pattern is observed:

- 1 occurrence → ignore
- 2 occurrences → monitor
- 3 occurrences → governance change

### Rationale

Governance reacts to trends, not anomalies.

---

## 4. How to Apply Changes Safely

### Rule

Each SOP update must:

- Change only **one concept or rule**
- Increment the version number (v1.1, v1.2, etc.)
- Include a short changelog entry

### Rationale

Small, versioned changes preserve stability and traceability.

---

## 5. What NOT to Add

Do not add rules based on:

- “Nice to have” ideas
- Hypothetical failures
- Temporary frustration
- Personal mood during coding

### Rationale

Governance bloat reduces effectiveness and compliance.

---

## 6. Post-Session Audit Questions

After a coding session, ask:

- Were all decisions explicit?
- Did any action happen without confirmation?
- Would this still be clear after 3 months?

If not, log it as a governance signal.

---

## 7. Long-Term Health Check

A healthy Governance SOP should feel:

- Predictable
- Slightly restrictive
- Boring
- Occasionally annoying

If it feels invisible, it is probably too weak.

---

## 8. Relationship to Other Documents

This guide supports:

- `AI Governance SOP.md`
- `Chat Execution Rules.md`

It does not override them.

---

## 9. Working Directory Governance Mirror

### Rule

- Canonical manual path: primary repo working copy (the VS Code-opened `zmstore-pos-2` folder)
- `.codex/worktrees/...` paths are reserved for explicit automation/isolated runs.
- Enforce preflight visibility with `pwd` and `git branch --show-current` before execution.

### Rationale

Using a single canonical path for manual work avoids branch/worktree confusion and keeps local validation and Git actions traceable.

End of Document.
