/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import * as React from "react";
import { Button } from "~/components/ui/Button";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTFormField } from "~/components/ui/SoTFormField";
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
    <main className="min-h-screen bg-[#f7f7fb] p-4">
      <div className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-md place-items-center">
        <SoTCard className="w-full p-6">
          <h1 className="text-xl font-semibold text-slate-900">Sign in</h1>
          <p className="mt-1 text-sm text-slate-600">
            Use your account credentials or cashier PIN.
          </p>

          <div className="mt-4 grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm">
            <button
              type="button"
              onClick={() => setTab("EMAIL")}
              className={`rounded-xl px-3 py-2 font-medium transition ${
                tab === "EMAIL"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-800"
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1`}
            >
              Email & Password
            </button>
            <button
              type="button"
              onClick={() => setTab("PIN")}
              className={`rounded-xl px-3 py-2 font-medium transition ${
                tab === "PIN"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-800"
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1`}
            >
              Cashier PIN
            </button>
          </div>

          {actionData?.form ? (
            <SoTAlert tone="danger" className="mt-3 text-sm">
              {actionData.form}
            </SoTAlert>
          ) : null}

          {tab === "EMAIL" ? (
            <Form method="post" className="mt-4 space-y-3" replace>
              <input type="hidden" name="mode" value="EMAIL" />
              <SoTFormField label="Email" error={actionData?.field?.email}>
                <input
                  name="email"
                  type="email"
                  className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  placeholder="admin@local"
                  required
                />
              </SoTFormField>
              <SoTFormField label="Password" error={actionData?.field?.password}>
                <input
                  name="password"
                  type="password"
                  className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  placeholder="••••••••"
                  required
                />
              </SoTFormField>
              <Button type="submit" variant="primary" className="w-full" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </Button>
            </Form>
          ) : (
            <Form method="post" className="mt-4 space-y-3" replace>
              <input type="hidden" name="mode" value="PIN" />
              <SoTFormField label="6-digit PIN" error={actionData?.field?.pin}>
                <input
                  name="pin"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  placeholder="123456"
                  required
                />
              </SoTFormField>
              <Button type="submit" variant="primary" className="w-full" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </Button>
            </Form>
          )}

          <div className="mt-4 space-y-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <div className="font-semibold text-slate-700">Dev creds (from seed):</div>
            <div>
              Admin: <code>admin@local</code> / <code>admin123</code>
            </div>
            <div>
              Managers: <code>manager1@local</code> / <code>manager1123</code>,{" "}
              <code>manager2@local</code> / <code>manager2123</code>
            </div>
            <div>
              Employees (riders): <code>rider1@local</code> / <code>rider1123</code>,{" "}
              <code>rider2@local</code> / <code>rider2123</code>, <code>rider3@local</code> /{" "}
              <code>rider3123</code>
            </div>
            <div>
              Cashier PINs: <code>111111</code>, <code>222222</code> (for active cashiers)
            </div>
          </div>
        </SoTCard>
      </div>
    </main>
  );
}
