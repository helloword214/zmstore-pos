import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { compare, hash } from "bcryptjs";
import { createHash } from "node:crypto";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { db } from "~/utils/db.server";
import { getUser, homePathFor } from "~/utils/auth.server";

type LoaderData = {
  valid: boolean;
};

type ActionData =
  | { ok: true; message: string }
  | { ok: false; message: string };

function tokenHash(rawToken: string) {
  return createHash("sha256").update(rawToken).digest("hex");
}

function requestIp(request: Request) {
  const fwd = request.headers.get("x-forwarded-for");
  if (!fwd) return null;
  return fwd.split(",")[0]?.trim() || null;
}

async function findActiveToken(rawToken: string) {
  const hashValue = tokenHash(rawToken);
  const now = new Date();
  return db.passwordResetToken.findFirst({
    where: {
      tokenHash: hashValue,
      usedAt: null,
      expiresAt: { gt: now },
      user: { active: true },
    },
    select: {
      id: true,
      userId: true,
      user: {
        select: {
          id: true,
          passwordHash: true,
        },
      },
    },
  });
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const me = await getUser(request);
  if (me) {
    throw redirect(homePathFor(me.role));
  }

  const rawToken = String(params.token ?? "").trim();
  if (!rawToken) return json<LoaderData>({ valid: false });

  const tokenRow = await findActiveToken(rawToken);
  return json<LoaderData>({ valid: Boolean(tokenRow) });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const rawToken = String(params.token ?? "").trim();
  if (!rawToken) {
    return json<ActionData>(
      { ok: false, message: "Invalid or expired reset link." },
      { status: 400 }
    );
  }

  const fd = await request.formData();
  const password = String(fd.get("password") ?? "");
  const confirmPassword = String(fd.get("confirmPassword") ?? "");

  if (password.length < 8) {
    return json<ActionData>(
      { ok: false, message: "Password must be at least 8 characters." },
      { status: 400 }
    );
  }
  if (password !== confirmPassword) {
    return json<ActionData>(
      { ok: false, message: "Password confirmation does not match." },
      { status: 400 }
    );
  }

  const tokenRow = await findActiveToken(rawToken);
  if (!tokenRow) {
    return json<ActionData>(
      { ok: false, message: "Invalid or expired reset link." },
      { status: 400 }
    );
  }

  if (tokenRow.user.passwordHash && (await compare(password, tokenRow.user.passwordHash))) {
    return json<ActionData>(
      { ok: false, message: "Please use a different password." },
      { status: 400 }
    );
  }

  const now = new Date();
  const ip = requestIp(request);
  const ua = request.headers.get("user-agent");

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: tokenRow.userId },
      data: {
        passwordHash: await hash(password, 12),
        pinHash: null,
        authState: "ACTIVE",
        authVersion: { increment: 1 },
      },
    });

    await tx.passwordResetToken.update({
      where: { id: tokenRow.id },
      data: {
        usedAt: now,
        consumedIp: ip,
        consumedUserAgent: ua,
      },
    });

    await tx.passwordResetToken.updateMany({
      where: {
        userId: tokenRow.userId,
        usedAt: null,
        id: { not: tokenRow.id },
      },
      data: { usedAt: now },
    });
  });

  return json<ActionData>({
    ok: true,
    message: "Password updated. You can now sign in with your new password.",
  });
}

export default function ResetPasswordPage() {
  const { valid } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  if (!valid) {
    return (
      <main className="min-h-screen bg-[#f7f7fb] p-4">
        <div className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-md place-items-center">
          <SoTCard className="w-full p-6">
            <h1 className="text-xl font-semibold text-slate-900">Reset Password</h1>
            <SoTAlert tone="danger" className="mt-3 text-sm">
              Invalid or expired reset link.
            </SoTAlert>
            <div className="mt-4 text-xs text-slate-600">
              Request a new link from{" "}
              <Link to="/forgot-password" className="font-medium text-indigo-700">
                Forgot password
              </Link>
              .
            </div>
          </SoTCard>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f7fb] p-4">
      <div className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-md place-items-center">
        <SoTCard className="w-full p-6">
          <h1 className="text-xl font-semibold text-slate-900">Set New Password</h1>
          <p className="mt-1 text-sm text-slate-600">Use at least 8 characters.</p>

          {actionData ? (
            <SoTAlert tone={actionData.ok ? "success" : "danger"} className="mt-3 text-sm">
              {actionData.message}
            </SoTAlert>
          ) : null}

          {actionData?.ok ? (
            <div className="mt-4 text-xs text-slate-600">
              Continue to{" "}
              <Link to="/login" className="font-medium text-indigo-700">
                Sign in
              </Link>
              .
            </div>
          ) : (
            <Form method="post" className="mt-4 space-y-3">
              <SoTFormField label="New password">
                <input
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  placeholder="At least 8 characters"
                />
              </SoTFormField>

              <SoTFormField label="Confirm new password">
                <input
                  name="confirmPassword"
                  type="password"
                  required
                  minLength={8}
                  className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  placeholder="Re-type password"
                />
              </SoTFormField>

              <SoTButton type="submit" variant="primary" disabled={busy}>
                {busy ? "Saving..." : "Update password"}
              </SoTButton>
            </Form>
          )}
        </SoTCard>
      </div>
    </main>
  );
}
