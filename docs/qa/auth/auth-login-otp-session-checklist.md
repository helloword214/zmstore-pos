# Auth Login OTP Session Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-19

This checklist is a secondary QA artifact.
It does not own identity or access behavior.

## Refer To

1. `docs/Governance SOP/QA Testing Architecture Standard.md`
2. `docs/guide/CANONICAL_IDENTITY_ACCESS_FLOW.md`

## Purpose

Verify one current manager sign-in flow using email, password, OTP verification, authenticated route access, and logout fallback.

## Setup

1. Run `npm run qa:auth:login-otp-session:setup`.
2. Start the local app server.
3. Use the seeded manager account unless your environment overrides it:
   - email: `manager1@local`
   - password: `manager1123`
4. If local SMTP is not configured, watch the app-server console for the OTP log line:
   - `[auth] SMTP not configured. Login OTP for <email>: <code> (expires in 5 min)`

## Manual QA Steps

1. Open `/login`.
2. Enter the manager email and password.
3. Click `Continue`.
4. Confirm the app redirects to `/login/otp`.
5. Enter the 6-digit OTP.
6. Click `Verify and sign in`.
7. Confirm the manager lands on `/store`.
8. Open `/store/payroll`.
9. Confirm the protected manager route stays accessible without returning to `/login`.
10. Click `Logout`, or open `/logout`.
11. Try opening `/store/payroll` again.

## Expected Outcomes

1. valid manager credentials advance from `/login` to `/login/otp`
2. successful OTP verification creates the authenticated session only after the code is accepted
3. successful sign-in lands the manager on `/store`
4. a protected manager route such as `/store/payroll` stays accessible while the session is active
5. logout destroys the session
6. protected manager routes fall back to `/login` after logout

## Cleanup

1. Run `npm run qa:auth:login-otp-session:cleanup`.
2. Close any local browser window used for the scenario.
