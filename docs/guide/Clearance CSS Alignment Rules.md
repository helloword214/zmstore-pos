# Clearance CSS Alignment Rules

Status: Active
Scope: Rider Check-in, Manager Clearance Inbox/Case, Remit screens

## Purpose

Keep clearance-related pages visually consistent so state interpretation is fast and audit-safe.

## Base Layout

- Page root: `min-h-screen bg-[#f7f7fb]`
- Container spacing: `mx-auto ... px-5 py-6`
- Section cards: `rounded-2xl border border-slate-200 bg-white shadow-sm`
- Sub-panels: `rounded-xl border border-slate-200 bg-slate-50`

## Typography

- Primary page title: `text-base font-semibold tracking-wide`
- Section title: `text-sm font-medium text-slate-800`
- Meta/help text: `text-xs text-slate-500` or `text-xs text-slate-600`
- Money/keys: use `font-mono`

## Status Pills

- Pill base: `inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]`
- `PENDING`: indigo (`border-indigo-200 bg-indigo-50 text-indigo-800`)
- `NEEDS_CLEARANCE`: amber (`border-amber-200 bg-amber-50 text-amber-800`)
- `REJECTED`: rose (`border-rose-200 bg-rose-50 text-rose-700`)
- `VOIDED`: slate (`border-slate-200 bg-slate-50 text-slate-600`)
- `FULLY_PAID`: emerald (`border-emerald-200 bg-emerald-50 text-emerald-700`)

## Buttons

- Primary action: indigo solid (`bg-indigo-600 text-white hover:bg-indigo-700`)
- Secondary action: white/slate border
- Destructive/reject: rose tint
- Disabled state must include `disabled:opacity-50`

## Consistency Rules

- Do not use custom/undefined shadow utilities (e.g., `shadow-xs` in this project setup).
- Reuse shared pill/card components where possible.
- Keep spacing rhythm in 2/3/4 scale (`gap-2`, `gap-3`, `p-3`, `p-4`).
- Avoid introducing a second visual language for clearance states.

## Review Checklist

- Are state colors identical across check-in, clearance, and remit?
- Are card radius/border/shadow tokens consistent?
- Are decision and balance values visually emphasized the same way?
- Are disabled and pending states clearly distinguishable?
