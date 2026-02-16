# ZMStore POS v2

Remix + Prisma POS/ERP system for cashier operations, delivery runs, rider check-in, remit workflow, and commercial clearance governance.

## Core Modules

- Cashier POS (tickets, payments, basic order lifecycle)
- Delivery runs (dispatch, rider check-in, manager remit)
- Commercial Clearance System (CCS v2.7)
- Customer A/R and settlement-linked records
- Cashier shift and variance workflows

## Tech Stack

- Remix (Vite)
- React + TypeScript
- Prisma ORM
- PostgreSQL
- Tailwind CSS

## Requirements

- Node.js `>= 20`
- npm
- PostgreSQL database

## Environment Variables

Minimum required for local run:

- `DATABASE_URL`
- `SHADOW_DATABASE_URL`
- `SESSION_SECRET`

Optional (storage/uploads):

- `STORAGE_DRIVER`
- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`

## Local Setup

```bash
npm install
npx prisma migrate dev
npx prisma generate
npm run dev
```

Open: `http://localhost:5173`

## Scripts

- `npm run dev` - start dev server
- `npm run build` - production build
- `npm run start` - start production server
- `npm run lint` - run ESLint
- `npm run typecheck` - run TypeScript checks

## Important Docs

- [Commercial Clearance System V2](docs/guide/Commercial%20Clearance%20System%20V2)
- [Accounts Receivable SoT](docs/guide/Accounts%20Receivable%20%E2%80%94%20Canonical%20Source%20of%20Truth%20(SoT))
- [Delivery Run Canonical Flow](docs/guide/DELIVERY_RUN_CANONICAL_FLOW.md)
- [Run Receipt Architecture](docs/guide/RunReceipt_Architecture.md)
- [AI Governance SOP](docs/Governance%20SOP/AI%20Governance%20SOP.md)
- [Chat Execution Rules](docs/Chat%20Operating%20Rules/Chat%20Execution%20Rules.md)

## Branch and PR Workflow

1. Create a feature branch: `codex/<task-name>`
2. Keep commits small and task-based
3. Open PR to `main`
4. Merge after review
5. Delete feature branch (local + remote)

## Notes

- Project-level collaboration guardrails are defined in `AGENTS.md`.
- CCS rules are enforced both at app level (gates) and schema level (status enum cleanup).
