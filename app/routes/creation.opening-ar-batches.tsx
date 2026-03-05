/* eslint-disable @typescript-eslint/no-explicit-any */
import { Prisma } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { SoTInput } from "~/components/ui/SoTInput";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import {
  SoTTable,
  SoTTableEmptyRow,
  SoTTableHead,
  SoTTableRow,
  SoTTh,
  SoTTd,
} from "~/components/ui/SoTTable";
import {
  OPENING_AR_RECEIPT_PREFIX,
  buildOpeningArReceiptKey,
  encodeOpeningBatchCaseNote,
  extractOpeningBatchRefFromReceiptKey,
  normalizeOpeningBatchRef,
  parseDueDateISO,
} from "~/services/openingArBatch.server";
import { requireRole } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import { MONEY_EPS, peso, r2 } from "~/utils/money";

type BatchSummary = {
  batchRef: string;
  rows: number;
  pending: number;
  decided: number;
  pendingBalance: number;
  latestAt: string | null;
};

type LoaderData = {
  summaries: BatchSummary[];
};

type InvalidRow = {
  lineNo: number;
  raw: string;
  errors: string[];
};

type ActionData =
  | {
      ok: true;
      batchRef: string;
      createdCount: number;
      invalidRows: InvalidRow[];
    }
  | {
      ok: false;
      error: string;
      invalidRows?: InvalidRow[];
    };

type ParsedDraft = {
  lineNo: number;
  raw: string;
  customerId: number | null;
  amount: number;
  dueDateRaw: string | null;
  refNo: string | null;
  lineNote: string | null;
  errors: string[];
};

function parseDraftLines(rowsText: string, defaultDueDateRaw: string | null) {
  const rawLines = String(rowsText || "").split(/\r?\n/);
  const drafts: ParsedDraft[] = [];

  for (let i = 0; i < rawLines.length; i += 1) {
    const lineNo = i + 1;
    const raw = rawLines[i];
    const trimmed = String(raw || "").trim();
    if (!trimmed) continue;

    const delimiter = trimmed.includes("\t")
      ? "\t"
      : trimmed.includes("|")
      ? "|"
      : ",";
    const cols = trimmed.split(delimiter).map((c) => c.trim());
    const first = String(cols[0] || "").toLowerCase();
    const second = String(cols[1] || "").toLowerCase();

    if (
      lineNo === 1 &&
      first.includes("customer") &&
      (second.includes("amount") || second.includes("balance"))
    ) {
      continue;
    }

    const customerIdNum = Number(cols[0] || 0);
    const customerId =
      Number.isFinite(customerIdNum) && Math.floor(customerIdNum) === customerIdNum && customerIdNum > 0
        ? customerIdNum
        : null;

    const amountRaw = String(cols[1] || "").replace(/[^0-9.-]/g, "");
    const amountParsed = Number(amountRaw);
    const amount = Number.isFinite(amountParsed) ? r2(amountParsed) : 0;

    const dueDateRaw = String(cols[2] || defaultDueDateRaw || "").trim() || null;
    const refNo = String(cols[3] || "").trim() || null;
    const lineNote =
      cols.length > 4 ? cols.slice(4).join(delimiter).trim() || null : null;

    const errors: string[] = [];
    if (!customerId) errors.push("customerId must be a positive integer.");
    if (!Number.isFinite(amount) || amount <= MONEY_EPS) {
      errors.push("amount must be greater than 0.");
    }
    if (dueDateRaw && !parseDueDateISO(dueDateRaw)) {
      errors.push("dueDate must be YYYY-MM-DD.");
    }

    drafts.push({
      lineNo,
      raw: trimmed,
      customerId,
      amount,
      dueDateRaw,
      refNo,
      lineNote,
      errors,
    });
  }

  return drafts;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]);

  const rows = await db.clearanceCase.findMany({
    where: { receiptKey: { startsWith: OPENING_AR_RECEIPT_PREFIX } } as any,
    select: {
      id: true,
      receiptKey: true,
      status: true,
      frozenTotal: true,
      cashCollected: true,
      flaggedAt: true,
    },
    orderBy: [{ flaggedAt: "desc" }, { id: "desc" }],
    take: 1000,
  });

  const grouped = new Map<string, BatchSummary>();
  for (const row of rows) {
    const batchRef = extractOpeningBatchRefFromReceiptKey(row.receiptKey);
    if (!batchRef) continue;

    const balance = r2(
      Math.max(0, Number(row.frozenTotal ?? 0) - Number(row.cashCollected ?? 0)),
    );
    const existing = grouped.get(batchRef);
    if (!existing) {
      grouped.set(batchRef, {
        batchRef,
        rows: 1,
        pending: row.status === "NEEDS_CLEARANCE" ? 1 : 0,
        decided: row.status === "DECIDED" ? 1 : 0,
        pendingBalance: row.status === "NEEDS_CLEARANCE" ? balance : 0,
        latestAt: row.flaggedAt ? new Date(row.flaggedAt as any).toISOString() : null,
      });
      continue;
    }

    existing.rows += 1;
    if (row.status === "NEEDS_CLEARANCE") {
      existing.pending += 1;
      existing.pendingBalance = r2(existing.pendingBalance + balance);
    } else if (row.status === "DECIDED") {
      existing.decided += 1;
    }

    if (row.flaggedAt) {
      const iso = new Date(row.flaggedAt as any).toISOString();
      if (!existing.latestAt || iso > existing.latestAt) existing.latestAt = iso;
    }
  }

  return json<LoaderData>({
    summaries: Array.from(grouped.values()).sort((a, b) =>
      String(b.latestAt || "").localeCompare(String(a.latestAt || "")),
    ),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const me = await requireRole(request, ["ADMIN"]);
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");
  if (intent !== "submitBatch") {
    return json<ActionData>({ ok: false, error: "Unsupported action." }, { status: 400 });
  }

  const rawBatchRef = String(fd.get("batchRef") || "");
  const batchRef = normalizeOpeningBatchRef(rawBatchRef);
  if (!batchRef) {
    return json<ActionData>(
      { ok: false, error: "Batch ref is required (letters/numbers only)." },
      { status: 400 },
    );
  }

  const sourceLabel = String(fd.get("sourceLabel") || "").trim() || null;
  const defaultDueDateRaw = String(fd.get("defaultDueDate") || "").trim() || null;
  if (defaultDueDateRaw && !parseDueDateISO(defaultDueDateRaw)) {
    return json<ActionData>(
      { ok: false, error: "Default due date must be YYYY-MM-DD." },
      { status: 400 },
    );
  }
  const batchNote = String(fd.get("batchNote") || "").trim() || null;
  const rowsText = String(fd.get("rowsText") || "");

  const drafts = parseDraftLines(rowsText, defaultDueDateRaw);
  if (!drafts.length) {
    return json<ActionData>(
      { ok: false, error: "Paste at least one row before submitting." },
      { status: 400 },
    );
  }
  if (drafts.length > 2000) {
    return json<ActionData>(
      { ok: false, error: "Batch limit is 2,000 rows per submit." },
      { status: 400 },
    );
  }

  const prefix = `OPENING_AR:${batchRef}:`;
  const existingBatch = await db.clearanceCase.count({
    where: { receiptKey: { startsWith: prefix } } as any,
  });
  if (existingBatch > 0) {
    return json<ActionData>(
      {
        ok: false,
        error: `Batch ref ${batchRef} already exists. Use a new batch ref.`,
      },
      { status: 400 },
    );
  }

  const uniqueCustomerIds = Array.from(
    new Set(
      drafts
        .map((row) => row.customerId)
        .filter((v): v is number => Number.isFinite(v) && Number(v) > 0),
    ),
  );
  const customerRows = uniqueCustomerIds.length
    ? await db.customer.findMany({
        where: { id: { in: uniqueCustomerIds } },
        select: { id: true },
      })
    : [];
  const customerIdSet = new Set(customerRows.map((c) => Number(c.id)));

  for (const row of drafts) {
    if (row.customerId && !customerIdSet.has(Number(row.customerId))) {
      row.errors.push(`customerId ${row.customerId} not found.`);
    }
  }

  const invalidRows: InvalidRow[] = drafts
    .filter((row) => row.errors.length > 0)
    .map((row) => ({
      lineNo: row.lineNo,
      raw: row.raw,
      errors: row.errors,
    }));

  const validRows = drafts.filter((row) => row.errors.length === 0);
  if (!validRows.length) {
    return json<ActionData>(
      {
        ok: false,
        error: "No valid rows to submit. Fix invalid rows and retry.",
        invalidRows,
      },
      { status: 400 },
    );
  }

  await db.$transaction(async (tx) => {
    for (const row of validRows) {
      const dueDateIso = row.dueDateRaw ? row.dueDateRaw : null;
      const created = await tx.clearanceCase.create({
        data: {
          status: "NEEDS_CLEARANCE",
          origin: "CASHIER",
          receiptKey: buildOpeningArReceiptKey(batchRef, row.lineNo),
          customerId: Number(row.customerId),
          frozenTotal: new Prisma.Decimal(row.amount.toFixed(2)),
          cashCollected: new Prisma.Decimal("0.00"),
          flaggedById: me.userId,
          flaggedAt: new Date(),
          note: encodeOpeningBatchCaseNote(
            {
              batchRef,
              lineNo: row.lineNo,
              dueDate: dueDateIso,
              refNo: row.refNo,
              sourceLabel,
              lineNote: row.lineNote,
            },
            batchNote,
          ),
        } as any,
        select: { id: true },
      });

      await tx.clearanceClaim.create({
        data: {
          caseId: Number(created.id),
          type: "OPEN_BALANCE",
          detail: row.lineNote,
        } as any,
      });
    }
  });

  return json<ActionData>({
    ok: true,
    batchRef,
    createdCount: validRows.length,
    invalidRows,
  });
}

export default function CreationOpeningArBatchesPage() {
  const { summaries } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const invalidRows = actionData?.invalidRows ?? [];

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Opening Balance Batch Encode"
        subtitle="Admin staging lane only. Manager approval is still required before AR creation."
        backTo="/"
        backLabel="Dashboard"
        maxWidthClassName="max-w-6xl"
      />

      <div className="mx-auto max-w-6xl space-y-4 px-5 py-6">
        <SoTAlert tone="info">
          Paste one row per line using format:
          <span className="ml-1 font-mono">
            customerId,amount,dueDate(YYYY-MM-DD),refNo,note
          </span>
          . You can also use tab-separated or <span className="font-mono">|</span>-separated rows.
        </SoTAlert>

        {actionData?.ok ? (
          <SoTAlert tone="success">
            Batch <span className="font-mono">{actionData.batchRef}</span> submitted.
            {" "}
            Created {actionData.createdCount} pending cases.
            {" "}
            Manager should process this at
            {" "}
            <span className="font-mono">/store/clearance-opening-batches</span>.
          </SoTAlert>
        ) : null}

        {!actionData?.ok && actionData?.error ? (
          <SoTAlert tone="warning">{actionData.error}</SoTAlert>
        ) : null}

        <SoTCard>
          <Form method="post" className="space-y-3">
            <input type="hidden" name="intent" value="submitBatch" />

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
              <SoTFormField label="Batch Ref">
                <SoTInput
                  name="batchRef"
                  placeholder="BOOK1-20260305"
                  required
                  maxLength={48}
                />
              </SoTFormField>

              <SoTFormField label="Source Label (optional)">
                <SoTInput name="sourceLabel" placeholder="Notebook 1" maxLength={80} />
              </SoTFormField>

              <SoTFormField label="Default Due Date (optional)">
                <SoTInput name="defaultDueDate" type="date" />
              </SoTFormField>

              <SoTFormField label="Batch Note (optional)">
                <SoTInput name="batchNote" placeholder="Imported from paper ledger" />
              </SoTFormField>
            </div>

            <SoTFormField label="Rows">
              <textarea
                name="rowsText"
                rows={12}
                required
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-800 outline-none focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
                placeholder={`customerId,amount,dueDate,refNo,note\n101,1500,2026-03-20,BOOK1-P1,opening balance\n102,420,,BOOK1-P2,\n`}
              />
            </SoTFormField>

            <div className="flex flex-wrap items-center gap-2">
              <SoTButton type="submit" variant="primary" disabled={busy}>
                {busy ? "Submitting..." : "Submit Batch"}
              </SoTButton>
            </div>
          </Form>
        </SoTCard>

        {invalidRows.length > 0 ? (
          <SoTCard className="overflow-hidden p-0">
            <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-800">
              Invalid Rows ({invalidRows.length})
            </div>
            <SoTTable>
              <SoTTableHead>
                <SoTTableRow>
                  <SoTTh>Line</SoTTh>
                  <SoTTh>Raw</SoTTh>
                  <SoTTh>Error</SoTTh>
                </SoTTableRow>
              </SoTTableHead>
              <tbody>
                {invalidRows.map((row) => (
                  <SoTTableRow key={`${row.lineNo}-${row.raw}`}>
                    <SoTTd className="font-mono text-xs">{row.lineNo}</SoTTd>
                    <SoTTd className="font-mono text-xs">{row.raw}</SoTTd>
                    <SoTTd className="text-xs text-rose-700">{row.errors.join(" ")}</SoTTd>
                  </SoTTableRow>
                ))}
              </tbody>
            </SoTTable>
          </SoTCard>
        ) : null}

        <SoTCard className="overflow-hidden p-0">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-800">
            Recent Opening Balance Batches
          </div>
          <SoTTable>
            <SoTTableHead>
              <SoTTableRow>
                <SoTTh>Batch Ref</SoTTh>
                <SoTTh align="right">Rows</SoTTh>
                <SoTTh align="right">Pending</SoTTh>
                <SoTTh align="right">Decided</SoTTh>
                <SoTTh align="right">Pending Balance</SoTTh>
                <SoTTh>Latest</SoTTh>
              </SoTTableRow>
            </SoTTableHead>
            <tbody>
              {summaries.length === 0 ? (
                <SoTTableEmptyRow colSpan={6} message="No opening balance batches yet." />
              ) : (
                summaries.map((s) => (
                  <SoTTableRow key={s.batchRef}>
                    <SoTTd className="font-mono text-xs">{s.batchRef}</SoTTd>
                    <SoTTd align="right" className="tabular-nums">
                      {s.rows}
                    </SoTTd>
                    <SoTTd align="right" className="tabular-nums">
                      {s.pending}
                    </SoTTd>
                    <SoTTd align="right" className="tabular-nums">
                      {s.decided}
                    </SoTTd>
                    <SoTTd align="right" className="tabular-nums font-semibold text-amber-700">
                      {peso(s.pendingBalance)}
                    </SoTTd>
                    <SoTTd className="text-xs text-slate-500">
                      {s.latestAt ? new Date(s.latestAt).toLocaleString() : "—"}
                    </SoTTd>
                  </SoTTableRow>
                ))
              )}
            </tbody>
          </SoTTable>
        </SoTCard>
      </div>
    </main>
  );
}
