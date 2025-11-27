Phase 1 — DB minimal auth

New tables/enums (add sa Prisma)

User

id, email? (unique), passwordHash?

pinHash? (para sa cashier fast login)

role = ADMIN | CASHIER | SELLER

active (default true)

employeeId? (optional link sa Employee)

createdAt, updatedAt, lastLoginAt?

UserLocation (pivot)

userId, locationId (unique composite)

CashierShift

id, cashierId(User), locationId

openedAt, closedAt?

openingFloat?, closingTotal?, deviceId?, notes?

Index: (cashierId,closedAt)

Done when: prisma migrate OK; tables appear.

Phase 2 — Seed (first login)

Create 1 Admin (email+password), assign at least 1 locationId.

Create 1 Cashier (PIN only ok), assign branch.

Create 1 Seller (password), assign branch.

Done when: kaya mong mag-query at makita ang tatlong users at kanilang locations.

Phase 3 — Session & helpers (server-side)

New helpers (in app/utils/auth.server.ts):

getUser(request) → returns { userId, role, branchIds, shiftId? } | null

requireUser(request) → redirects /login if none

requireRole(request, role[]) → 403/redirect kapag bawal

requireOpenShift(request) → cashier-only guard for finalize/pay/remit

createUserSession({ userId, role, branchIds }) → sets pos_session

logout(request) → clears pos_session

Done when: may unit/route loader usage na gumagana (manual test) kahit simple page.

Phase 4 — Login/Logout routes

/login accepts:

Admin/Seller: email + password

Cashier: 6-digit PIN (walang email)

Post-login redirects:

Admin → /

Cashier → /cashier

Seller → /pad-order

/logout clears session, then → /login

Done when: tatlong test users above ay nakaka-login at nare-redirect tama.

Phase 5 — Route gating (map to your tree)

Seller (allow):

pad-order.\_index.tsx

Read-only APIs: api.customers.search.ts, api.customer-pricing.tsx, resources.products-search.tsx

Root / (dashboard) but links limited (Order Pad only)

Cashier (allow):

cashier.\_index.tsx, cashier.$id.tsx

orders.new.tsx (counter sale)

orders.$id.receipt.tsx, receipts.\_index.tsx

remit.$id.tsx, remit-summary.$id.tsx, remit-receipt.$id.tsx

Root / with cashier quick actions

Admin (allow all):

lahat ng natitira: runs._, settings._, products._, customers._, dev._, ar._, etc.

Guard specifics

Payment/finalize/remit pages → requireOpenShift

Non-allowed → 403 page with “Go to your home” link (role-aware).

Done when: direct URL access by wrong role → blocked & friendly redirect.

Phase 6 — Dashboard gating (your / index)

Quick Actions visibility by role:

Seller: Open Order Pad

Cashier: Open Cashier Queue, Receipts, Remit

Admin: Runs, Create Run, Reports, Settings (+ optional Cashier Queue)

Hide “Reports/Settings/Runs” for non-Admin.

(Optional) KPIs shown only to Admin (or obfuscate for others).

Done when: iba-iba ang nakikita per role sa parehong /.

Phase 7 — Shift lifecycle (cashier)

cashier.\_index.tsx → Open Shift (creates CashierShift, sets shiftId in session)

Finalize/pay/remit require active shiftId

Close Shift → sets closedAt, clears shiftId from session

Done when: hindi makapag-finalize ang cashier na walang open shift.

Phase 8 — Audits & safety (minimum)

Log login/logout (User.lastLoginAt, simple audit row optional)

Reprint/void/refund require reason (keep as TODO if wala pa UI)

No hard deletes (policy note; keep current behavior if already soft)

Done when: at least login timestamps are recorded; reasons wired later.

Phase 9 — Rollout & checks

Migrate: run prisma migrate on staging, then prod

Seed: create initial Admin/Cashier/Seller

Env: ensure SESSION_SECRET set

Smoke tests:

Seller blocked on /cashier and /settings

Cashier blocked on /settings & /runs.new

Cashier can’t finalize without open shift

Admin can access everything

Direct deep links return 403/redirect correctly

Done when: 5/5 smoke tests pass.
