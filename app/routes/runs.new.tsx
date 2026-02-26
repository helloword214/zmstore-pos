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
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
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
    } catch {
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
      <SoTNonDashboardHeader
        title="New Delivery Run"
        subtitle="Create a free delivery run (no parent order)."
        backTo="/runs"
        backLabel="Runs"
        maxWidthClassName="max-w-xl"
      />

      <div className="mx-auto max-w-xl p-5">
        {actionData && !actionData.ok && (
          <SoTAlert tone="danger" className="mb-3 text-sm" role="alert" aria-live="polite">
            {actionData.error}
          </SoTAlert>
        )}

        <SoTCard>
          <Form
            method="post"
            className={`grid gap-3 ${busy ? "opacity-60 pointer-events-none" : ""}`}
          >
            <SoTFormField
              label={
                <>
                  Rider <span className="text-rose-600">*</span>
                </>
              }
            >
              <SelectInput
                options={[
                  { value: "", label: "— Select rider —" },
                  ...riders.map((r) => ({ value: String(r.id), label: r.label })),
                ]}
                value={riderId}
                onChange={(v) => setRiderId(String(v))}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <input type="hidden" name="riderId" value={riderId} />
            </SoTFormField>

            <SoTFormField
              label={
                <>
                  Vehicle <span className="text-slate-400">(optional)</span>
                </>
              }
            >
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
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <input type="hidden" name="vehicleId" value={vehicleId} />
            </SoTFormField>

            <SoTFormField
              label={
                <>
                  Notes <span className="text-slate-400">(optional)</span>
                </>
              }
            >
              <textarea
                id="notes"
                name="notes"
                rows={3}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
              />
            </SoTFormField>

            <div className="pt-2">
              <SoTButton variant="primary" disabled={busy}>
                {busy ? "Creating…" : "Create & Continue"}
              </SoTButton>
            </div>
          </Form>
        </SoTCard>
      </div>
    </main>
  );
}
