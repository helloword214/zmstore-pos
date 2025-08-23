# POS Business Plan

> 📌 Purpose:  
> This document describes the **big picture business logic** of the POS system.  
> It explains _why_ the system behaves this way, not just _how to code it_.
>
> 🛠 When to update:
>
> - When a **new rule** is added (e.g., discount policy changes).
> - When a **milestone** is completed (add summary under "Milestones Applied").
> - When a **business decision** is reversed (cross out old rule, add new one with date).
>
> ✅ Readers:
>
> - Self-taught devs (like us now).
> - Future devs joining the project.
> - Non-technical stakeholders who want to understand the workflow.

---

## Vision

Fast-food style **Kiosk → Cashier → Fulfillment** flow adapted to retail (rice, feeds, pet supplies, LPG).

## Core Principles

- **Kiosk**: Customer builds order, prints Order Slip (NO discounts).
- **Cashier**: Verifies order, applies discounts, collects payment.
- **Receipt**: Only issued when order is `PAID`.
- **Inventory**: Deducted only when `PAID`.
- **Fulfillment**: Picking/Packing starts after payment.

---

## Milestones Applied

### Milestone 1 — Order Slip

- Slip shows **totals before discounts**.
- Discounts are not applied at kiosk.
- Expiry: 24h by default.
- Reprint allowed (`Reprint #n` footer).

### Milestone 2 — Cashier Queue & Scan

- Cashier sees all `UNPAID` orders in queue.
- Orders lock when cashier opens (to prevent double handling).
- Cashier can apply discounts (senior, PWD, promo).
- Manager PIN required for manual/override discounts.

### Milestone 3 — Payment & Receipt

- Payment methods: Cash, GCash, Card.
- Split payments supported.
- Change always returned in cash.
- Official Receipt printed only when `PAID`.

### Milestone 4 — Fulfillment

- Fulfillment states: `NEW → PICKING → PACKING → READY_FOR_PICKUP → HANDED_OVER`.
- Pick Ticket prints after `PAID`.
- Open Sack allowed during packing (convert sack → retail stock).
- Abandoned orders marked `UNCLAIMED` after timeout.
