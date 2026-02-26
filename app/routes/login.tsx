import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { compare } from "bcryptjs";
import { Button } from "~/components/ui/Button";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { db } from "~/utils/db.server";
import { createUserSession, getUser, homePathFor } from "~/utils/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const me = await getUser(request);
  if (me) {
    throw redirect(homePathFor(me.role));
  }
  return json({ ok: true });
}

type ActionError = {
  form?: string;
  field?: Record<string, string>;
};

export async function action({ request }: ActionFunctionArgs) {
  const fd = await request.formData();
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

  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      active: true,
      authState: true,
      role: true,
      passwordHash: true,
    },
  });

  if (
    !user ||
    !user.active ||
    (user.role !== "ADMIN" &&
      user.role !== "STORE_MANAGER" &&
      user.role !== "EMPLOYEE" &&
      user.role !== "CASHIER")
  ) {
    return json<ActionError>({ form: "Invalid credentials." }, { status: 400 });
  }

  if (!user.passwordHash || !(await compare(password, user.passwordHash))) {
    return json<ActionError>({ form: "Invalid credentials." }, { status: 400 });
  }
  if (user.authState !== "ACTIVE") {
    return json<ActionError>(
      { form: "Account setup is incomplete. Check your email and set your password first." },
      { status: 400 }
    );
  }

  const { headers } = await createUserSession(request, user.id);
  return redirect(homePathFor(user.role), { headers });
}

export default function LoginPage() {
  const actionData = useActionData<ActionError>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  return (
    <main className="min-h-screen bg-[#f7f7fb] p-4">
      <div className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-md place-items-center">
        <SoTCard className="w-full p-6">
          <h1 className="text-xl font-semibold text-slate-900">Sign in</h1>
          <p className="mt-1 text-sm text-slate-600">
            Use your email and password.
          </p>

          {actionData?.form ? (
            <SoTAlert tone="danger" className="mt-3 text-sm">
              {actionData.form}
            </SoTAlert>
          ) : null}

          <Form method="post" className="mt-4 space-y-3" replace>
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

            <div className="flex items-center justify-between text-xs">
              <a
                href="/forgot-password"
                className="font-medium text-indigo-700 hover:text-indigo-600"
              >
                Forgot password?
              </a>
            </div>

            <Button type="submit" variant="primary" className="w-full" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </Form>

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
              Cashiers: <code>cashier1@local</code> / <code>cashier1123</code>,{" "}
              <code>cashier2@local</code> / <code>cashier2123</code>
            </div>
          </div>
        </SoTCard>
      </div>
    </main>
  );
}
