import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { SoTLoadingState } from "~/components/ui/SoTLoadingState";
import {
  clearPendingLogin,
  createUserSession,
  getPendingLogin,
  getUser,
  homePathFor,
  trustLoginDevice,
} from "~/utils/auth.server";
import {
  checkLoginThrottle,
  clearAuthFailureState,
  getActiveLoginOtpChallenge,
  isOtpCodeFormat,
  LOGIN_OTP_EXPIRES_MINUTES,
  LOGIN_OTP_MAX_SENDS,
  maskEmail,
  otpResendRetryAfterSeconds,
  registerAuthFailure,
  requestIp,
  resendLoginOtpChallenge,
  verifyLoginOtpCode,
} from "~/utils/auth-login-guard.server";
import { sendLoginOtpEmail } from "~/utils/mail.server";

type LoaderData = {
  maskedEmail: string;
  expiresAtIso: string;
  resendInSeconds: number;
  sendCount: number;
  maxSendCount: number;
};

type ActionData = {
  ok?: boolean;
  message?: string;
  form?: string;
  field?: Record<string, string>;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const me = await getUser(request);
  if (me) {
    throw redirect(homePathFor(me.role));
  }

  const pending = await getPendingLogin(request);
  if (!pending) {
    throw redirect("/login");
  }

  const now = new Date();
  const challenge = await getActiveLoginOtpChallenge({
    challengeId: pending.challengeId,
    userId: pending.userId,
    now,
  });

  if (!challenge) {
    const { headers } = await clearPendingLogin(request);
    throw redirect("/login", { headers });
  }

  return json<LoaderData>({
    maskedEmail: maskEmail(pending.email),
    expiresAtIso: challenge.expiresAt.toISOString(),
    resendInSeconds: otpResendRetryAfterSeconds(challenge.lastSentAt, now),
    sendCount: challenge.sendCount,
    maxSendCount: LOGIN_OTP_MAX_SENDS,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const pending = await getPendingLogin(request);
  if (!pending) {
    throw redirect("/login");
  }

  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "verify").trim().toLowerCase();
  const ip = requestIp(request);
  const userAgent = request.headers.get("user-agent");

  if (intent === "resend") {
    const resend = await resendLoginOtpChallenge({
      challengeId: pending.challengeId,
      userId: pending.userId,
      requestIp: ip,
      userAgent,
    });

    if (!resend.ok) {
      if (resend.reason === "NOT_FOUND") {
        const { headers } = await clearPendingLogin(request);
        return redirect("/login", { headers });
      }
      if (resend.reason === "MAX_SENDS") {
        return json<ActionData>(
          {
            form: "Resend limit reached. Sign in again to request a fresh code.",
          },
          { status: 400 },
        );
      }
      return json<ActionData>(
        {
          form: `Please wait ${Math.max(1, resend.retryAfterSeconds ?? 0)} second(s) before requesting another code.`,
        },
        { status: 429 },
      );
    }

    try {
      await sendLoginOtpEmail({
        to: pending.email,
        otpCode: resend.otpCode,
        expiresMinutes: LOGIN_OTP_EXPIRES_MINUTES,
      });
      return json<ActionData>({
        ok: true,
        message: "A new verification code was sent.",
      });
    } catch (error) {
      console.error("[auth] resend login otp failed", error);
      return json<ActionData>(
        { form: "Failed to resend code. Please try again." },
        { status: 500 },
      );
    }
  }

  const code = String(fd.get("code") ?? "").trim();
  if (!isOtpCodeFormat(code)) {
    return json<ActionData>(
      {
        field: {
          code: "Enter the 6-digit code sent to your email.",
        },
      },
      { status: 400 },
    );
  }

  const throttle = await checkLoginThrottle({ email: pending.email, ip });
  if (throttle.blocked) {
    return json<ActionData>(
      {
        form: `Too many failed attempts. Try again in about ${Math.max(1, Math.ceil(throttle.retryAfterSeconds / 60))} minute(s).`,
      },
      { status: 429 },
    );
  }

  const verified = await verifyLoginOtpCode({
    challengeId: pending.challengeId,
    userId: pending.userId,
    code,
    requestIp: ip,
    userAgent,
  });

  if (!verified.ok) {
    if (verified.reason === "NOT_FOUND_OR_EXPIRED") {
      const { headers } = await clearPendingLogin(request);
      return redirect("/login", { headers });
    }

    await registerAuthFailure({ email: pending.email, ip });

    if (verified.reason === "TOO_MANY_ATTEMPTS") {
      const { headers } = await clearPendingLogin(request);
      return redirect("/login", { headers });
    }

    return json<ActionData>(
      {
        form: `Invalid verification code.${
          typeof verified.attemptsLeft === "number"
            ? ` ${verified.attemptsLeft} attempt(s) remaining.`
            : ""
        }`,
      },
      { status: 400 },
    );
  }

  await clearAuthFailureState({ email: pending.email, ip });
  const session = await createUserSession(request, verified.userId);
  const trustedDevice = await trustLoginDevice(request, {
    userId: verified.userId,
    authVersion: session.user.authVersion,
  });
  const headers = new Headers();
  headers.append("Set-Cookie", session.setCookie);
  headers.append("Set-Cookie", trustedDevice.setCookie);
  return redirect(homePathFor(session.user.role), { headers });
}

export default function LoginOtpPage() {
  const loaderData = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const nav = useNavigation();
  const submitting = nav.state === "submitting";
  const loading = nav.state === "loading";
  const busy = nav.state !== "idle";
  const pendingIntent = String(nav.formData?.get("intent") ?? "");
  const verifyBusy = pendingIntent === "verify" && busy;
  const resendBusy = pendingIntent === "resend" && busy;

  const expiresLabel = new Date(loaderData.expiresAtIso).toLocaleTimeString();
  const sendsRemaining = Math.max(0, loaderData.maxSendCount - loaderData.sendCount);

  return (
    <main className="min-h-screen bg-[#f7f7fb] p-4">
      <div className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-md place-items-center">
        <SoTCard className="w-full p-6">
          <h1 className="text-xl font-semibold text-slate-900">Verify sign-in</h1>
          <p className="mt-1 text-sm text-slate-600">
            Enter the 6-digit code sent to <span className="font-medium">{loaderData.maskedEmail}</span>.
          </p>
          <p className="mt-1 text-xs text-slate-500">Code expires at {expiresLabel}.</p>
          <p className="mt-1 text-xs text-slate-500">
            After verification, this browser will stay trusted unless its cookies are cleared or account security changes.
          </p>

          {actionData?.form ? (
            <SoTAlert tone="danger" className="mt-3 text-sm">
              {actionData.form}
            </SoTAlert>
          ) : null}

          {actionData?.ok && actionData.message ? (
            <SoTAlert tone="success" className="mt-3 text-sm">
              {actionData.message}
            </SoTAlert>
          ) : null}

          <Form method="post" className="mt-4 space-y-3" replace>
            <fieldset disabled={busy} className="space-y-3 disabled:cursor-not-allowed disabled:opacity-70">
              <input type="hidden" name="intent" value="verify" />
              <SoTFormField label="Verification code" error={actionData?.field?.code}>
                <input
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm tracking-[0.3em] outline-none focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  placeholder="123456"
                />
              </SoTFormField>

              {verifyBusy ? (
                <SoTLoadingState
                  variant="inline"
                  label="Verifying your code"
                  hint="Checking the one-time password and trusted device."
                />
              ) : null}

              <SoTButton type="submit" variant="primary" className="w-full" disabled={busy}>
                {submitting && verifyBusy
                  ? "Verifying…"
                  : loading && pendingIntent === "verify"
                    ? "Signing you in…"
                    : "Verify and sign in"}
              </SoTButton>
            </fieldset>
          </Form>

          <div className="mt-4 space-y-2 text-xs text-slate-600">
            <Form method="post" replace>
              <fieldset
                disabled={busy || sendsRemaining <= 0}
                className="space-y-2 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <input type="hidden" name="intent" value="resend" />
                {resendBusy ? (
                  <SoTLoadingState
                    variant="inline"
                    label="Sending a new code"
                    hint="Preparing another verification email."
                  />
                ) : null}
                <SoTButton type="submit" variant="secondary" disabled={busy || sendsRemaining <= 0}>
                  {resendBusy ? "Sending…" : "Resend code"}
                </SoTButton>
              </fieldset>
            </Form>

            <div>
              {sendsRemaining > 0
                ? `Resends left: ${sendsRemaining}.`
                : "Resend limit reached. Return to login to request a new code."}
            </div>
            {loaderData.resendInSeconds > 0 ? (
              <div>Next resend available in about {loaderData.resendInSeconds} second(s).</div>
            ) : null}
            <div>
              Back to <Link to="/login" className="font-medium text-indigo-700">Sign in</Link>
            </div>
          </div>
        </SoTCard>
      </div>
    </main>
  );
}
