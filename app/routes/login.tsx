/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import * as React from "react";
import { db } from "~/utils/db.server";
import { createUserSession, getUser, homePathFor } from "~/utils/auth.server";
import { compare } from "bcryptjs";

export async function loader({ request }: LoaderFunctionArgs) {
  const me = await getUser(request);
  if (me) {
    throw redirect(homePathFor(me.role));
  }
  return json({ ok: true });
}

type ActionError = { form?: string; field?: Record<string, string> };

export async function action({ request }: ActionFunctionArgs) {
  const fd = await request.formData();
  const mode = String(fd.get("mode") ?? "");

  // EMAIL/PASSWORD LOGIN (ADMIN, STORE_MANAGER, EMPLOYEE)
  if (mode === "EMAIL") {
    const email = String(fd.get("email") ?? "")
      .trim()
      .toLowerCase();
    const password = String(fd.get("password") ?? "");
    if (!email || !password) {
      return json<ActionError>(
        { field: { email: "Required", password: "Required" } },
        { status: 400 }
      );
    }
    const user = await db.user.findUnique({ where: { email } });
    if (
      !user ||
      !user.active ||
      (user.role !== "ADMIN" &&
        user.role !== "STORE_MANAGER" &&
        user.role !== "EMPLOYEE")
    ) {
      return json<ActionError>(
        { form: "Invalid credentials." },
        { status: 400 }
      );
    }
    if (!user.passwordHash || !(await compare(password, user.passwordHash))) {
      return json<ActionError>(
        { form: "Invalid credentials." },
        { status: 400 }
      );
    }
    const { headers } = await createUserSession(request, user.id);
    // homePathFor() na ang bahala mag-redirect:
    // ADMIN -> "/"
    // STORE_MANAGER -> "/store"
    // CASHIER -> "/cashier" (PIN login)
    // EMPLOYEE -> "/rider" (frontline dashboard)
    return redirect(homePathFor(user.role as any), { headers });
  }

  // PIN LOGIN (CASHIER)
  if (mode === "PIN") {
    const pin = String(fd.get("pin") ?? "").trim();
    if (!pin) {
      return json<ActionError>({ field: { pin: "Required" } }, { status: 400 });
    }
    // For simplicity v1: scan active cashiers and match pinHash
    const cashiers = await db.user.findMany({
      where: { role: "CASHIER", active: true, pinHash: { not: null } },
      select: { id: true, pinHash: true },
    });
    let matchedId: number | null = null;
    for (const c of cashiers) {
      if (c.pinHash && (await compare(pin, c.pinHash))) {
        matchedId = c.id;
        break;
      }
    }
    if (!matchedId) {
      return json<ActionError>({ form: "Invalid PIN." }, { status: 400 });
    }
    const { headers } = await createUserSession(request, matchedId);
    // Cashiers land on the dashboard instead of raw POS
    return redirect(homePathFor("CASHIER"), { headers });
  }

  return json<ActionError>(
    { form: "Unsupported login mode." },
    { status: 400 }
  );
}

export default function LoginPage() {
  const actionData = useActionData<ActionError>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const [tab, setTab] = React.useState<"EMAIL" | "PIN">("EMAIL");
  return (
    <main className="min-h-screen grid place-items-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Sign in</h1>
        <div className="mt-4 grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm">
          <button
            type="button"
            onClick={() => setTab("EMAIL")}
            className={`rounded-lg py-1.5 ${
              tab === "EMAIL"
                ? "bg-white shadow text-slate-900"
                : "text-slate-600"
            }`}
          >
            Email & Password
          </button>
          <button
            type="button"
            onClick={() => setTab("PIN")}
            className={`rounded-lg py-1.5 ${
              tab === "PIN"
                ? "bg-white shadow text-slate-900"
                : "text-slate-600"
            }`}
          >
            Cashier PIN
          </button>
        </div>

        {actionData?.form && (
          <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">
            {actionData.form}
          </div>
        )}

        {tab === "EMAIL" ? (
          <Form method="post" className="mt-4 space-y-3" replace>
            <input type="hidden" name="mode" value="EMAIL" />
            <label className="block text-sm">
              <span className="text-slate-700">Email</span>
              <input
                name="email"
                type="email"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                placeholder="admin@local"
                required
              />
              {actionData?.field?.email && (
                <span className="text-xs text-rose-600">
                  {actionData.field.email}
                </span>
              )}
            </label>
            <label className="block text-sm">
              <span className="text-slate-700">Password</span>
              <input
                name="password"
                type="password"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                placeholder="••••••••"
                required
              />
              {actionData?.field?.password && (
                <span className="text-xs text-rose-600">
                  {actionData.field.password}
                </span>
              )}
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </Form>
        ) : (
          <Form method="post" className="mt-4 space-y-3" replace>
            <input type="hidden" name="mode" value="PIN" />
            <label className="block text-sm">
              <span className="text-slate-700">6-digit PIN</span>
              <input
                name="pin"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                placeholder="123456"
                required
              />
              {actionData?.field?.pin && (
                <span className="text-xs text-rose-600">
                  {actionData.field.pin}
                </span>
              )}
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </Form>
        )}

        <p className="mt-4 text-xs text-slate-500 space-y-1">
          <span className="block font-semibold">Dev creds (from seed):</span>
          <span className="block">
            Admin: <code>admin@local</code> / <code>admin123</code>
          </span>
          <span className="block">
            Managers: <code>manager1@local</code> / <code>manager1123</code>,{" "}
            <code>manager2@local</code> / <code>manager2123</code>
          </span>
          <span className="block">
            Employees (riders): <code>rider1@local</code> /{" "}
            <code>rider1123</code>, <code>rider2@local</code> /{" "}
            <code>rider2123</code>, <code>rider3@local</code> /{" "}
            <code>rider3123</code>
          </span>
          <span className="block">
            Cashier PINs: <code>111111</code>, <code>222222</code> (for active
            cashiers)
          </span>
        </p>
      </div>
    </main>
  );
}
