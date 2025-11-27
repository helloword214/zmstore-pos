// app/routes/runs.new.tsx

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import * as React from "react";
import { db } from "~/utils/db.server";
import { SelectInput } from "~/components/ui/SelectInput";
import { requireRole } from "~/utils/auth.server";

type LoaderData = {
  riders: Array<{ id: number; label: string }>;
  vehicles: Array<{ id: number; name: string }>;
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN", "STORE_MANAGER"]); // 🔒 guard
  const employees = await db.employee.findMany({
    where: { role: "RIDER", active: true },
    select: { id: true, firstName: true, lastName: true, alias: true },
    orderBy: [{ alias: "asc" }, { firstName: "asc" }, { lastName: "asc" }],
  });
  const riders = employees.map((e) => ({
    id: e.id,
    label: (e.alias?.trim() ||
      [e.firstName, e.lastName].filter(Boolean).join(" ") ||
      `#${e.id}`)!,
  }));

  const vehicles = await db.vehicle.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return json<LoaderData>({ riders, vehicles });
}

type ActionData = { ok: true; id: number } | { ok: false; error: string };

function makeRunCode() {
  const d = new Date();
  const y = String(d.getFullYear()).slice(2);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `RN-${y}${m}${day}-${rand}`;
}

export async function action({ request }: ActionFunctionArgs) {
  await requireRole(request, ["ADMIN", "STORE_MANAGER"]); // 🔒 guard for writes
  const fd = await request.formData();
  const riderId = Number(fd.get("riderId") || NaN);
  const vehicleId = fd.get("vehicleId") ? Number(fd.get("vehicleId")) : null;
  const notes = (String(fd.get("notes") || "").trim() || null) as string | null;

  if (!Number.isFinite(riderId) || riderId <= 0) {
    return json<ActionData>(
      { ok: false, error: "Select a rider." },
      { status: 400 }
    );
  }
  const rider = await db.employee.findUnique({
    where: { id: riderId },
    select: { id: true, active: true, role: true },
  });
  if (!rider || !rider.active || rider.role !== "RIDER") {
    return json<ActionData>(
      { ok: false, error: "Invalid rider." },
      { status: 400 }
    );
  }

  // generate unique runCode (retry on rare collision)
  let runCode = makeRunCode();
  for (let i = 0; i < 4; i++) {
    try {
      const run = await db.deliveryRun.create({
        data: {
          runCode,
          status: "PLANNED",
          riderId,
          vehicleId: vehicleId && vehicleId > 0 ? vehicleId : null,
          notes,
        },
        select: { id: true },
      });
      return redirect(`/runs/${run.id}/dispatch`);
    } catch (e: any) {
      // unique violation → retry a different code
      runCode = makeRunCode();
    }
  }
  return json<ActionData>(
    { ok: false, error: "Failed to create run." },
    { status: 500 }
  );
}

export default function NewRunPage() {
  const { riders, vehicles } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const actionData = useActionData<ActionData>();
  const busy = nav.state !== "idle";

  const [riderId, setRiderId] = React.useState<string>("");
  const [vehicleId, setVehicleId] = React.useState<string>("");

  // stable, unique ids for a11y label → control association

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <div className="mx-auto max-w-xl p-5">
        <h1 className="text-lg font-semibold text-slate-900">
          New Delivery Run
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Create a free delivery run (no parent order).
        </p>

        {actionData && !actionData.ok && (
          <div
            className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
            role="alert"
            aria-live="polite"
          >
            {actionData.error}
          </div>
        )}

        <Form
          method="post"
          className={`mt-4 grid gap-3 ${
            busy ? "opacity-60 pointer-events-none" : ""
          }`}
        >
          <div className="grid gap-1">
            {/* NOTE: Huwag gumamit ng <label> dito dahil custom component (SelectInput) at hindi siya recognized ng a11y rule */}
            <div className="text-sm text-slate-700">
              Rider <span className="text-rose-600">*</span>
            </div>
            <SelectInput
              options={[
                { value: "", label: "— Select rider —" },
                ...riders.map((r) => ({ value: String(r.id), label: r.label })),
              ]}
              value={riderId}
              onChange={(v) => setRiderId(String(v))}
              className="rounded-md border px-3 py-2 text-sm w-full"
            />
            <input type="hidden" name="riderId" value={riderId} />
          </div>
          <div className="grid gap-1">
            {/* Same reason: plain text header + SelectInput, walang <label> */}
            <div className="text-sm text-slate-700">
              Vehicle <span className="text-slate-400">(optional)</span>
            </div>
            <SelectInput
              options={[
                { value: "", label: "— Select vehicle —" },
                ...vehicles.map((v) => ({
                  value: String(v.id),
                  label: v.name,
                })),
              ]}
              value={vehicleId}
              onChange={(v) => setVehicleId(String(v))}
              className="rounded-md border px-3 py-2 text-sm w-full"
            />
            <input type="hidden" name="vehicleId" value={vehicleId} />
          </div>

          <div className="grid gap-1">
            <label htmlFor="notes" className="text-sm text-slate-700">
              Notes <span className="text-slate-400">(optional)</span>
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={3}
              className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
            />
          </div>
          <div className="pt-2">
            <button
              className="rounded-xl bg-indigo-600 text-white px-4 py-2 text-sm disabled:opacity-50"
              disabled={busy}
            >
              {busy ? "Creating…" : "Create & Continue"}
            </button>
          </div>
        </Form>
      </div>
    </main>
  );
}
