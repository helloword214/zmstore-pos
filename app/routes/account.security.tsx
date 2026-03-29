import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { compare, hash } from "bcryptjs";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { SoTLoadingState } from "~/components/ui/SoTLoadingState";
import { requireUser } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import {
  requestIp,
} from "~/utils/auth-login-guard.server";
import { resolveAppBaseUrl, sendPasswordResetEmail } from "~/utils/mail.server";
import { createHash, randomBytes } from "node:crypto";

type LoaderData = {
  me: {
    userId: number;
    role: string;
    email: string | null;
  };
  supportsPin: boolean;
};

type ActionData = {
  ok: boolean;
  section: "password" | "reset-link" | "pin";
  message: string;
};

function tokenHash(rawToken: string) {
  return createHash("sha256").update(rawToken).digest("hex");
}

function isManagerOrCashier(role: string) {
  return role === "STORE_MANAGER" || role === "CASHIER";
}

function isSixDigitPin(input: string) {
  return /^\d{6}$/.test(input);
}

export async function loader({ request }: LoaderFunctionArgs) {
  const me = await requireUser(request);
  const current = await db.user.findUnique({
    where: { id: me.userId },
    select: { id: true, role: true, email: true },
  });
  if (!current) {
    throw new Response("User not found", { status: 404 });
  }

  return json<LoaderData>({
    me: {
      userId: current.id,
      role: current.role,
      email: current.email,
    },
    supportsPin: isManagerOrCashier(current.role),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const me = await requireUser(request);
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "").trim();

  const actor = await db.user.findUnique({
    where: { id: me.userId },
    select: {
      id: true,
      role: true,
      email: true,
      passwordHash: true,
      pinHash: true,
      active: true,
      authState: true,
      authVersion: true,
    },
  });

  if (!actor || !actor.active) {
    throw new Response("User not found", { status: 404 });
  }

  if (intent === "change-password") {
    const currentPassword = String(fd.get("currentPassword") ?? "");
    const newPassword = String(fd.get("newPassword") ?? "");
    const confirmPassword = String(fd.get("confirmPassword") ?? "");

    if (!currentPassword || !newPassword || !confirmPassword) {
      return json<ActionData>(
        {
          ok: false,
          section: "password",
          message: "All password fields are required.",
        },
        { status: 400 },
      );
    }

    if (newPassword.length < 8) {
      return json<ActionData>(
        {
          ok: false,
          section: "password",
          message: "New password must be at least 8 characters.",
        },
        { status: 400 },
      );
    }

    if (newPassword !== confirmPassword) {
      return json<ActionData>(
        {
          ok: false,
          section: "password",
          message: "Password confirmation does not match.",
        },
        { status: 400 },
      );
    }

    if (!actor.passwordHash || !(await compare(currentPassword, actor.passwordHash))) {
      return json<ActionData>(
        {
          ok: false,
          section: "password",
          message: "Current password is incorrect.",
        },
        { status: 400 },
      );
    }

    if (await compare(newPassword, actor.passwordHash)) {
      return json<ActionData>(
        {
          ok: false,
          section: "password",
          message: "Please use a different password.",
        },
        { status: 400 },
      );
    }

    await db.user.update({
      where: { id: actor.id },
      data: {
        passwordHash: await hash(newPassword, 12),
        authVersion: { increment: 1 },
      },
    });

    return json<ActionData>({
      ok: true,
      section: "password",
      message: "Password updated successfully.",
    });
  }

  if (intent === "send-reset-link") {
    if (!actor.email) {
      return json<ActionData>(
        {
          ok: false,
          section: "reset-link",
          message: "No account email is configured for this user.",
        },
        { status: 400 },
      );
    }

    const rawToken = randomBytes(32).toString("hex");
    const hashValue = tokenHash(rawToken);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 1000 * 60 * 30);
    const ip = requestIp(request);
    const ua = request.headers.get("user-agent");

    await db.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: {
          userId: actor.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });

      await tx.passwordResetToken.create({
        data: {
          userId: actor.id,
          tokenHash: hashValue,
          expiresAt,
          requestedIp: ip,
          requestedUserAgent: ua,
        },
      });
    });

    const baseUrl = resolveAppBaseUrl(request);
    const resetUrl = `${baseUrl}/reset-password/${rawToken}`;
    await sendPasswordResetEmail({ to: actor.email, resetUrl });

    return json<ActionData>({
      ok: true,
      section: "reset-link",
      message: "Password reset link sent to your email.",
    });
  }

  if (intent === "update-pin") {
    if (!isManagerOrCashier(actor.role)) {
      return json<ActionData>(
        {
          ok: false,
          section: "pin",
          message: "PIN setup is only available for manager and cashier accounts.",
        },
        { status: 403 },
      );
    }

    const currentPassword = String(fd.get("currentPassword") ?? "");
    const currentPin = String(fd.get("currentPin") ?? "");
    const newPin = String(fd.get("newPin") ?? "").trim();
    const confirmPin = String(fd.get("confirmPin") ?? "").trim();

    if (!isSixDigitPin(newPin) || !isSixDigitPin(confirmPin)) {
      return json<ActionData>(
        {
          ok: false,
          section: "pin",
          message: "PIN must be exactly 6 digits.",
        },
        { status: 400 },
      );
    }

    if (newPin !== confirmPin) {
      return json<ActionData>(
        {
          ok: false,
          section: "pin",
          message: "PIN confirmation does not match.",
        },
        { status: 400 },
      );
    }

    let authorized = false;

    if (actor.passwordHash && currentPassword) {
      authorized = await compare(currentPassword, actor.passwordHash);
    }

    if (!authorized && actor.pinHash && currentPin) {
      authorized = await compare(currentPin, actor.pinHash);
    }

    if (!authorized) {
      return json<ActionData>(
        {
          ok: false,
          section: "pin",
          message: "Provide your current password or current PIN to continue.",
        },
        { status: 400 },
      );
    }

    if (actor.pinHash && (await compare(newPin, actor.pinHash))) {
      return json<ActionData>(
        {
          ok: false,
          section: "pin",
          message: "Please use a different PIN.",
        },
        { status: 400 },
      );
    }

    await db.user.update({
      where: { id: actor.id },
      data: {
        pinHash: await hash(newPin, 12),
      },
    });

    return json<ActionData>({
      ok: true,
      section: "pin",
      message: "PIN updated successfully.",
    });
  }

  return json<ActionData>(
    {
      ok: false,
      section: "password",
      message: "Unsupported action.",
    },
    { status: 400 },
  );
}

export default function AccountSecurityPage() {
  const { me, supportsPin } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const pendingIntent = String(navigation.formData?.get("intent") ?? "");
  const passwordBusy = busy && pendingIntent === "change-password";
  const resetLinkBusy = busy && pendingIntent === "send-reset-link";
  const pinBusy = busy && pendingIntent === "update-pin";

  return (
    <main className="min-h-screen bg-[#f7f7fb] p-5">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Account Security</h1>
          <p className="mt-1 text-sm text-slate-600">
            Signed in as <span className="font-medium">{me.email ?? `USER#${me.userId}`}</span> · {me.role}
          </p>
          <div className="mt-2 text-xs text-slate-500">
            Back to <Link to="/" className="font-medium text-indigo-700">dashboard</Link>
          </div>
        </div>

        {actionData ? (
          <SoTAlert tone={actionData.ok ? "success" : "danger"} className="text-sm">
            {actionData.message}
          </SoTAlert>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <SoTCard className="p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Change Password</h2>
            <Form method="post" className="mt-3 space-y-3">
              <input type="hidden" name="intent" value="change-password" />
              <SoTFormField label="Current password">
                <input
                  type="password"
                  name="currentPassword"
                  required
                  className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
                />
              </SoTFormField>
              <SoTFormField label="New password">
                <input
                  type="password"
                  name="newPassword"
                  minLength={8}
                  required
                  className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
                />
              </SoTFormField>
              <SoTFormField label="Confirm new password">
                <input
                  type="password"
                  name="confirmPassword"
                  minLength={8}
                  required
                  className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
                />
              </SoTFormField>
              {passwordBusy ? (
                <SoTLoadingState
                  variant="inline"
                  label="Updating password"
                  hint="Saving your new sign-in password."
                />
              ) : null}
              <SoTButton type="submit" variant="primary" disabled={busy}>
                {passwordBusy ? "Updating..." : "Update password"}
              </SoTButton>
            </Form>
          </SoTCard>

          <SoTCard className="p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Password Reset Link</h2>
            <p className="mt-2 text-sm text-slate-600">
              Send a reset link to your account email.
            </p>
            <Form method="post" className="mt-3 space-y-3">
              <input type="hidden" name="intent" value="send-reset-link" />
              {resetLinkBusy ? (
                <SoTLoadingState
                  variant="inline"
                  label="Sending reset link"
                  hint="Preparing a password reset email for this account."
                />
              ) : null}
              <SoTButton type="submit" variant="secondary" disabled={busy || !me.email}>
                {resetLinkBusy ? "Sending..." : "Send reset link"}
              </SoTButton>
            </Form>
            {!me.email ? (
              <p className="mt-2 text-xs text-rose-600">No email configured on this account.</p>
            ) : null}
            <p className="mt-2 text-xs text-slate-500">
              Public recovery is still available at <code>/forgot-password</code>.
            </p>
          </SoTCard>
        </div>

        {supportsPin ? (
          <SoTCard className="p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Manager/Cashier PIN</h2>
            <p className="mt-2 text-sm text-slate-600">
              PIN must be exactly 6 digits. Use your current password or current PIN to authorize updates.
            </p>
            <Form method="post" className="mt-3 grid gap-3 md:grid-cols-2">
              <input type="hidden" name="intent" value="update-pin" />
              <SoTFormField label="Current password (optional)">
                <input
                  type="password"
                  name="currentPassword"
                  className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
                />
              </SoTFormField>
              <SoTFormField label="Current PIN (optional)">
                <input
                  type="password"
                  name="currentPin"
                  inputMode="numeric"
                  maxLength={6}
                  className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
                />
              </SoTFormField>
              <SoTFormField label="New 6-digit PIN">
                <input
                  type="password"
                  name="newPin"
                  inputMode="numeric"
                  pattern="\\d{6}"
                  maxLength={6}
                  required
                  className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
                />
              </SoTFormField>
              <SoTFormField label="Confirm new PIN">
                <input
                  type="password"
                  name="confirmPin"
                  inputMode="numeric"
                  pattern="\\d{6}"
                  maxLength={6}
                  required
                  className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
                />
              </SoTFormField>
              {pinBusy ? (
                <div className="md:col-span-2">
                  <SoTLoadingState
                    variant="inline"
                    label="Updating PIN"
                    hint="Verifying your credentials and saving the new PIN."
                  />
                </div>
              ) : null}
              <div className="md:col-span-2">
                <SoTButton type="submit" variant="secondary" disabled={busy}>
                  {pinBusy ? "Updating..." : "Update PIN"}
                </SoTButton>
              </div>
            </Form>
          </SoTCard>
        ) : null}
      </div>
    </main>
  );
}
