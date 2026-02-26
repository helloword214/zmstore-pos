import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { UserAuthState } from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useNavigation } from "@remix-run/react";
import { createHash, randomBytes } from "node:crypto";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { db } from "~/utils/db.server";
import { getUser, homePathFor } from "~/utils/auth.server";
import {
  resolveAppBaseUrl,
  sendPasswordResetEmail,
  sendPasswordSetupEmail,
} from "~/utils/mail.server";

type ActionData =
  | { ok: true; message: string }
  | { ok: false; message: string };

const SUCCESS_MESSAGE =
  "If the account exists, we sent a password reset link to that email.";

function tokenHash(rawToken: string) {
  return createHash("sha256").update(rawToken).digest("hex");
}

function requestIp(request: Request) {
  const fwd = request.headers.get("x-forwarded-for");
  if (!fwd) return null;
  return fwd.split(",")[0]?.trim() || null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const me = await getUser(request);
  if (me) {
    throw redirect(homePathFor(me.role));
  }
  return json({ ok: true });
}

export async function action({ request }: ActionFunctionArgs) {
  const fd = await request.formData();
  const email = String(fd.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (!email) {
    return json<ActionData>(
      { ok: false, message: "Email is required." },
      { status: 400 }
    );
  }

  try {
    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, email: true, active: true, authState: true },
    });

    if (user?.active && user.email) {
      const rawToken = randomBytes(32).toString("hex");
      const hash = tokenHash(rawToken);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 1000 * 60 * 30);
      const ip = requestIp(request);
      const ua = request.headers.get("user-agent");

      await db.$transaction(async (tx) => {
        await tx.passwordResetToken.updateMany({
          where: {
            userId: user.id,
            usedAt: null,
            expiresAt: { gt: now },
          },
          data: { usedAt: now },
        });

        await tx.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: hash,
            expiresAt,
            requestedIp: ip,
            requestedUserAgent: ua,
          },
        });
      });

      const baseUrl = resolveAppBaseUrl(request);
      const resetUrl = `${baseUrl}/reset-password/${rawToken}`;
      if (user.authState === UserAuthState.PENDING_PASSWORD) {
        await sendPasswordSetupEmail({ to: user.email, setupUrl: resetUrl });
      } else {
        await sendPasswordResetEmail({ to: user.email, resetUrl });
      }
    }

    return json<ActionData>({ ok: true, message: SUCCESS_MESSAGE });
  } catch (e) {
    console.error("[auth] forgot-password failed", e);
    return json<ActionData>(
      { ok: false, message: "Password reset is temporarily unavailable. Please try again later." },
      { status: 500 }
    );
  }
}

export default function ForgotPasswordPage() {
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <main className="min-h-screen bg-[#f7f7fb] p-4">
      <div className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-md place-items-center">
        <SoTCard className="w-full p-6">
          <h1 className="text-xl font-semibold text-slate-900">Forgot Password</h1>
          <p className="mt-1 text-sm text-slate-600">
            Enter your account email and we will send a password reset link.
          </p>

          {actionData ? (
            <SoTAlert tone={actionData.ok ? "success" : "danger"} className="mt-3 text-sm">
              {actionData.message}
            </SoTAlert>
          ) : null}

          <Form method="post" className="mt-4 space-y-3">
            <SoTFormField label="Email">
              <input
                name="email"
                type="email"
                required
                className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                placeholder="you@company.com"
              />
            </SoTFormField>

            <SoTButton type="submit" variant="primary" disabled={busy}>
              {busy ? "Sending..." : "Send reset link"}
            </SoTButton>
          </Form>

          <div className="mt-4 text-xs text-slate-600">
            Back to <Link to="/login" className="font-medium text-indigo-700">Sign in</Link>
          </div>
        </SoTCard>
      </div>
    </main>
  );
}
