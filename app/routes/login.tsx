import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useNavigation, useOutlet } from "@remix-run/react";
import { compare } from "bcryptjs";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { SoTLoadingState } from "~/components/ui/SoTLoadingState";
import { SoTSearchInput } from "~/components/ui/SoTSearchInput";
import {
  createUserSession,
  getPendingLogin,
  getUser,
  homePathFor,
  isTrustedLoginDevice,
  setPendingLogin,
} from "~/utils/auth.server";
import {
  checkLoginThrottle,
  clearAuthFailureState,
  issueLoginOtpChallenge,
  LOGIN_OTP_EXPIRES_MINUTES,
  normalizeEmail,
  registerAuthFailure,
  requestIp,
} from "~/utils/auth-login-guard.server";
import { db } from "~/utils/db.server";
import { sendLoginOtpEmail } from "~/utils/mail.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const me = await getUser(request);
  if (me) {
    throw redirect(homePathFor(me.role));
  }

  const pending = await getPendingLogin(request);
  const pathname = new URL(request.url).pathname;
  const onBaseLoginRoute = pathname === "/login" || pathname === "/login/";
  if (pending && onBaseLoginRoute) {
    throw redirect("/login/otp");
  }

  return json({ ok: true });
}

type ActionError = {
  form?: string;
  field?: Record<string, string>;
};

export async function action({ request }: ActionFunctionArgs) {
  const fd = await request.formData();
  const email = normalizeEmail(String(fd.get("email") ?? ""));
  const password = String(fd.get("password") ?? "");
  const ip = requestIp(request);
  const userAgent = request.headers.get("user-agent");

  if (!email || !password) {
    return json<ActionError>(
      { field: { email: "Required", password: "Required" } },
      { status: 400 },
    );
  }

  const throttle = await checkLoginThrottle({ email, ip });
  if (throttle.blocked) {
    return json<ActionError>(
      {
        form: `Too many failed attempts. Try again in about ${Math.max(1, Math.ceil(throttle.retryAfterSeconds / 60))} minute(s).`,
      },
      { status: 429 },
    );
  }

  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      active: true,
      authState: true,
      role: true,
      passwordHash: true,
      authVersion: true,
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
    await registerAuthFailure({ email, ip });
    return json<ActionError>({ form: "Invalid credentials." }, { status: 400 });
  }

  if (!user.passwordHash) {
    return json<ActionError>(
      {
        form:
          user.authState !== "ACTIVE"
            ? "Account setup is incomplete. Check your email and set your password first."
            : "This account is missing a login password. Use Forgot password or ask an admin to send a setup link.",
      },
      { status: 400 },
    );
  }

  if (!(await compare(password, user.passwordHash))) {
    await registerAuthFailure({ email, ip });
    return json<ActionError>({ form: "Invalid credentials." }, { status: 400 });
  }

  if (user.authState !== "ACTIVE") {
    return json<ActionError>(
      { form: "Account setup is incomplete. Check your email and set your password first." },
      { status: 400 },
    );
  }

  if (!user.email) {
    await registerAuthFailure({ email, ip });
    return json<ActionError>({ form: "Invalid credentials." }, { status: 400 });
  }

  const trustedDevice = await isTrustedLoginDevice(request, {
    userId: user.id,
    authVersion: user.authVersion,
  });

  if (trustedDevice) {
    await clearAuthFailureState({ email, ip });
    const { headers, user: sessionUser } = await createUserSession(request, user.id);
    return redirect(homePathFor(sessionUser.role), { headers });
  }

  try {
    const challenge = await issueLoginOtpChallenge({
      userId: user.id,
      requestIp: ip,
      userAgent,
    });

    await sendLoginOtpEmail({
      to: user.email,
      otpCode: challenge.otpCode,
      expiresMinutes: LOGIN_OTP_EXPIRES_MINUTES,
    });

    const { headers } = await setPendingLogin(request, {
      userId: user.id,
      challengeId: challenge.challengeId,
      email,
    });

    return redirect("/login/otp", { headers });
  } catch (error) {
    console.error("[auth] login otp issue failed", error);
    return json<ActionError>(
      { form: "Sign-in verification is temporarily unavailable. Please try again." },
      { status: 500 },
    );
  }
}

export default function LoginPage() {
  const outlet = useOutlet();
  const actionData = useActionData<ActionError>();
  const nav = useNavigation();
  const submitting = nav.state === "submitting";
  const loading = nav.state === "loading";
  const busy = nav.state !== "idle";
  if (outlet) return outlet;

  return (
    <main className="min-h-screen bg-[#f7f7fb] p-4">
      <div className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-md place-items-center">
        <SoTCard className="w-full p-6">
          <h1 className="text-xl font-semibold text-slate-900">Sign in</h1>
          <p className="mt-1 text-sm text-slate-600">
            Use your email and password. New or untrusted devices will ask for a one-time verification code.
          </p>

          {actionData?.form ? (
            <SoTAlert tone="danger" className="mt-3 text-sm">
              {actionData.form}
            </SoTAlert>
          ) : null}

          <Form method="post" className="mt-4 space-y-3" replace>
            <fieldset disabled={busy} className="space-y-3 disabled:cursor-not-allowed disabled:opacity-70">
              <SoTFormField label="Email" error={actionData?.field?.email}>
                <SoTSearchInput
                  name="email"
                  type="email"
                  placeholder="admin@local"
                  required
                />
              </SoTFormField>
              <SoTFormField label="Password" error={actionData?.field?.password}>
                <SoTSearchInput
                  name="password"
                  type="password"
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

              {submitting ? (
                <SoTLoadingState
                  variant="inline"
                  label="Checking your sign-in"
                  hint="Verifying credentials and device."
                />
              ) : null}

              <SoTButton type="submit" variant="primary" className="w-full" disabled={busy}>
                {submitting ? "Checking credentials…" : loading ? "Continuing…" : "Continue"}
              </SoTButton>
            </fieldset>
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
