# Auth Role Routing Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-19

This checklist is a secondary QA artifact.
It does not own identity or access behavior.

## Refer To

1. `docs/Governance SOP/QA Testing Architecture Standard.md`
2. `docs/guide/CANONICAL_IDENTITY_ACCESS_FLOW.md`

## Purpose

Verify that authenticated users land on the correct home lane and are redirected away from representative wrong-role routes.

## Setup

1. Run `npm run qa:auth:role-routing:setup`.
2. Start the local app server.
3. Use the seeded accounts unless your environment overrides them:
   - admin: `admin@local`
   - manager: `manager1@local`
   - cashier: `cashier1@local`
   - rider: `rider1@local`

## Manual QA Steps

### Admin

1. Sign in as `ADMIN`.
2. Open `/login` while still authenticated.
3. Confirm the app redirects to `/`.
4. Open `/store`.
5. Confirm the app redirects back to `/`.

### Store Manager

1. Sign in as `STORE_MANAGER`.
2. Open `/login` while still authenticated.
3. Confirm the app redirects to `/store`.
4. Open `/products`.
5. Confirm the app redirects back to `/store`.

### Cashier

1. Sign in as `CASHIER`.
2. Open `/login` while still authenticated.
3. Confirm the app redirects to `/cashier`.
4. Open `/store`.
5. Confirm the app redirects back to `/cashier`.

### Rider

1. Sign in as rider `EMPLOYEE`.
2. Open `/login` while still authenticated.
3. Confirm the app redirects to `/rider`.
4. Open `/store`.
5. Confirm the app redirects back to `/rider`.

## Expected Outcomes

1. authenticated `ADMIN` users land on `/`
2. authenticated `STORE_MANAGER` users land on `/store`
3. authenticated `CASHIER` users land on `/cashier`
4. authenticated rider `EMPLOYEE` users land on `/rider`
5. representative wrong-lane routes redirect users back to their own home lane

## Cleanup

1. Run `npm run qa:auth:role-routing:cleanup`.
2. Log out of any browser session used during manual QA.
