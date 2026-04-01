import {
  ClearanceCaseStatus,
  ClearanceDecisionKind,
  CustomerArStatus,
  Prisma,
} from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { SoTInput } from "~/components/ui/SoTInput";
import { SoTLoadingState } from "~/components/ui/SoTLoadingState";
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
  decodeOpeningBatchCaseNote,
  extractOpeningBatchRefFromReceiptKey,
  normalizeOpeningBatchRef,
  parseDueDateISO,
} from "~/services/openingArBatch.server";
import { requireRole } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import { MONEY_EPS, peso, r2 } from "~/utils/money";

type BatchSummary = {
  batchRef: string;
  pendingCount: number;
  pendingBalance: number;
  autoRejectCount: number;
  latestAt: string | null;
};

type BatchRow = {
  caseId: number;
  batchRef: string;
  receiptKey: string;
  customerId: number | null;
  customerLabel: string;
  frozenTotal: number;
  cashCollected: number;
  balance: number;
  dueDate: string | null;
  refNo: string | null;
  lineNote: string | null;
  autoRejectReason: string | null;
  flaggedAt: string | null;
};

type LoaderData = {
  batches: BatchSummary[];
  selectedBatchRef: string | null;
  selectedRows: BatchRow[];
  flash: {
    approved: number;
    rejected: number;
    processed: number;
  } | null;
};

function toCustomerLabel(
  c:
    | {
        firstName?: string | null;
        middleName?: string | null;
        lastName?: string | null;
        alias?: string | null;
        phone?: string | null;
      }
    | null
    | undefined,
  customerId: number | null,
) {
  const name = [c?.firstName, c?.middleName, c?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const alias = c?.alias ? ` (${c.alias})` : "";
  const phone = c?.phone ? ` • ${c.phone}` : "";
  if (name) return `${name}${alias}${phone}`;
  return customerId ? `Customer #${customerId}` : "No customer";
}

function parseRejectIds(values: FormDataEntryValue[]) {
  const ids = new Set<number>();
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && Math.floor(n) === n && n > 0) ids.add(n);
  }
  return ids;
}

function computeAutoRejectReason(row: {
  customerId: number | null;
  balance: number;
}) {
  if (!row.customerId) return "Missing customer.";
  if (row.balance <= MONEY_EPS) return "No remaining balance.";
  return null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["STORE_MANAGER"]);
  const url = new URL(request.url);

  const rows = await db.clearanceCase.findMany({
    where: {
      status: ClearanceCaseStatus.NEEDS_CLEARANCE,
      receiptKey: { startsWith: OPENING_AR_RECEIPT_PREFIX },
    },
    select: {
      id: true,
      receiptKey: true,
      customerId: true,
      frozenTotal: true,
      cashCollected: true,
      note: true,
      flaggedAt: true,
      customer: {
        select: {
          firstName: true,
          middleName: true,
          lastName: true,
          alias: true,
          phone: true,
        },
      },
    },
    orderBy: [{ flaggedAt: "asc" }, { id: "asc" }],
    take: 5000,
  });

  const mappedRows: BatchRow[] = rows
    .map((row) => {
      const batchRef = extractOpeningBatchRefFromReceiptKey(row.receiptKey);
      if (!batchRef) return null;
      const balance = r2(
        Math.max(0, Number(row.frozenTotal ?? 0) - Number(row.cashCollected ?? 0)),
      );
      const decoded = decodeOpeningBatchCaseNote(row.note);
      const autoRejectReason = computeAutoRejectReason({
        customerId: row.customerId ?? null,
        balance,
      });
      return {
        caseId: Number(row.id),
        batchRef,
        receiptKey: String(row.receiptKey),
        customerId: row.customerId ?? null,
        customerLabel: toCustomerLabel(row.customer, row.customerId ?? null),
        frozenTotal: r2(Math.max(0, Number(row.frozenTotal ?? 0))),
        cashCollected: r2(Math.max(0, Number(row.cashCollected ?? 0))),
        balance,
        dueDate: decoded.meta?.dueDate ?? null,
        refNo: decoded.meta?.refNo ?? null,
        lineNote: decoded.meta?.lineNote ?? null,
        autoRejectReason,
        flaggedAt: row.flaggedAt ? new Date(row.flaggedAt).toISOString() : null,
      } as BatchRow;
    })
    .filter((row): row is BatchRow => Boolean(row));

  const grouped = new Map<string, BatchSummary>();
  for (const row of mappedRows) {
    const existing = grouped.get(row.batchRef);
    if (!existing) {
      grouped.set(row.batchRef, {
        batchRef: row.batchRef,
        pendingCount: 1,
        pendingBalance: row.balance,
        autoRejectCount: row.autoRejectReason ? 1 : 0,
        latestAt: row.flaggedAt,
      });
      continue;
    }
    existing.pendingCount += 1;
    existing.pendingBalance = r2(existing.pendingBalance + row.balance);
    if (row.autoRejectReason) existing.autoRejectCount += 1;
    if (row.flaggedAt && (!existing.latestAt || row.flaggedAt > existing.latestAt)) {
      existing.latestAt = row.flaggedAt;
    }
  }

  const batches = Array.from(grouped.values()).sort((a, b) =>
    String(b.latestAt || "").localeCompare(String(a.latestAt || "")),
  );

  const selectedBatchRefRaw = String(url.searchParams.get("batchRef") || "").trim();
  const selectedBatchRef = selectedBatchRefRaw
    ? normalizeOpeningBatchRef(selectedBatchRefRaw)
    : batches[0]?.batchRef ?? null;
  const selectedRows = selectedBatchRef
    ? mappedRows.filter((row) => row.batchRef === selectedBatchRef)
    : [];

  const approved = Number(url.searchParams.get("approved") || 0);
  const rejected = Number(url.searchParams.get("rejected") || 0);
  const processed = Number(url.searchParams.get("processed") || 0);
  const flash =
    approved > 0 || rejected > 0 || processed > 0
      ? { approved, rejected, processed }
      : null;

  return json<LoaderData>({
    batches,
    selectedBatchRef,
    selectedRows,
    flash,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const me = await requireRole(request, ["STORE_MANAGER"]);
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");
  if (intent !== "approveValidRows") {
    return json({ ok: false, error: "Unsupported action." }, { status: 400 });
  }

  const rawBatchRef = String(fd.get("batchRef") || "");
  const batchRef = normalizeOpeningBatchRef(rawBatchRef);
  if (!batchRef) {
    return json({ ok: false, error: "batchRef is required." }, { status: 400 });
  }

  const rejectIds = parseRejectIds(fd.getAll("rejectCaseIds"));
  const approveNote =
    String(fd.get("approveNote") || "").trim() || "Opening balance batch approved.";
  const rejectNote = String(fd.get("rejectNote") || "").trim() || null;
  const prefix = `OPENING_AR:${batchRef}:`;

  let approvedCount = 0;
  let rejectedCount = 0;
  let processedCount = 0;

  await db.$transaction(async (tx) => {
    const cases = await tx.clearanceCase.findMany({
      where: {
        status: ClearanceCaseStatus.NEEDS_CLEARANCE,
        receiptKey: { startsWith: prefix },
      },
      select: {
        id: true,
        customerId: true,
        orderId: true,
        runId: true,
        frozenTotal: true,
        cashCollected: true,
        note: true,
      },
      orderBy: [{ flaggedAt: "asc" }, { id: "asc" }],
      take: 5000,
    });

    for (const row of cases) {
      const caseId = Number(row.id);
      const balance = r2(
        Math.max(0, Number(row.frozenTotal ?? 0) - Number(row.cashCollected ?? 0)),
      );
      const decoded = decodeOpeningBatchCaseNote(row.note);
      const isManualReject = rejectIds.has(caseId);
      const autoRejectReason = computeAutoRejectReason({
        customerId: row.customerId ?? null,
        balance,
      });

      if (isManualReject || autoRejectReason) {
        const reason = isManualReject
          ? `Rejected in batch review.${rejectNote ? ` ${rejectNote}` : ""}`
          : `Auto-rejected: ${autoRejectReason}`;
        await tx.clearanceDecision.create({
          data: {
            caseId,
            kind: ClearanceDecisionKind.REJECT,
            decidedById: me.userId,
            note: reason.slice(0, 500),
          },
        });
        await tx.clearanceCase.update({
          where: { id: caseId },
          data: { status: ClearanceCaseStatus.DECIDED },
        });
        rejectedCount += 1;
        processedCount += 1;
        continue;
      }

      if (!row.customerId) {
        rejectedCount += 1;
        processedCount += 1;
        continue;
      }

      const arBalance = r2(Math.max(0, balance));
      const decision = await tx.clearanceDecision.create({
        data: {
          caseId,
          kind: ClearanceDecisionKind.APPROVE_OPEN_BALANCE,
          decidedById: me.userId,
          note: approveNote.slice(0, 500),
          arBalance: new Prisma.Decimal(arBalance.toFixed(2)),
        },
        select: { id: true },
      });

      const dueDate = parseDueDateISO(decoded.meta?.dueDate || null);
      const arNoteParts = [
        `Opening balance batch ${batchRef}`,
        decoded.meta?.refNo ? `ref ${decoded.meta.refNo}` : null,
        decoded.meta?.lineNote ? decoded.meta.lineNote : null,
      ].filter(Boolean);

      await tx.customerAr.create({
        data: {
          customerId: Number(row.customerId),
          clearanceDecisionId: Number(decision.id),
          ...(row.orderId ? { orderId: Number(row.orderId) } : {}),
          ...(row.runId ? { runId: Number(row.runId) } : {}),
          principal: new Prisma.Decimal(arBalance.toFixed(2)),
          balance: new Prisma.Decimal(arBalance.toFixed(2)),
          status: CustomerArStatus.OPEN,
          ...(dueDate ? { dueDate } : {}),
          note: arNoteParts.join(" • ").slice(0, 500),
        },
      });

      await tx.clearanceCase.update({
        where: { id: caseId },
        data: { status: ClearanceCaseStatus.DECIDED },
      });

      approvedCount += 1;
      processedCount += 1;
    }
  });

  const qs = new URLSearchParams();
  qs.set("batchRef", batchRef);
  qs.set("approved", String(approvedCount));
  qs.set("rejected", String(rejectedCount));
  qs.set("processed", String(processedCount));
  return redirect(`/store/clearance-opening-batches?${qs.toString()}`);
}

export default function StoreClearanceOpeningBatchesPage() {
  const { batches, selectedBatchRef, selectedRows, flash } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const processingBusy = String(nav.formData?.get("intent") ?? "") === "approveValidRows" && busy;
  const [sp] = useSearchParams();
  const batchRefFromUrl = String(sp.get("batchRef") || "").trim();
  const activeBatchRef = selectedBatchRef || batchRefFromUrl || null;
  const selectedPendingBalance = selectedRows.reduce(
    (sum, row) => sum + row.balance,
    0,
  );
  const selectedAutoRejectCount = selectedRows.filter(
    (row) => Boolean(row.autoRejectReason),
  ).length;

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Opening Balance Clearance Batches"
        subtitle="Approve valid rows and reject only exceptions."
        backTo="/store/clearance"
        backLabel="Clearance Inbox"
        maxWidthClassName="max-w-6xl"
      />

      <div className="mx-auto max-w-6xl space-y-4 px-5 py-6">
        <div className="flex flex-wrap gap-2 text-xs text-slate-600">
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">
            Batches{" "}
            <span className="font-semibold text-slate-900">{batches.length}</span>
          </span>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">
            Selected rows{" "}
            <span className="font-semibold text-slate-900">{selectedRows.length}</span>
          </span>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">
            Pending balance{" "}
            <span className="font-semibold text-slate-900">
              {peso(selectedPendingBalance)}
            </span>
          </span>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">
            Auto-reject{" "}
            <span className="font-semibold text-slate-900">
              {selectedAutoRejectCount}
            </span>
          </span>
        </div>

        <SoTAlert tone="info">
          Valid rows are approved by default. Checked rows and invalid rows are rejected.
        </SoTAlert>

        {flash ? (
          <SoTAlert tone="success">
            Processed {flash.processed} row(s): approved {flash.approved}, rejected{" "}
            {flash.rejected}.
          </SoTAlert>
        ) : null}

        <SoTCard className="overflow-hidden p-0">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-800">
            Pending Batches
          </div>
          <SoTTable>
            <SoTTableHead>
              <SoTTableRow>
                <SoTTh>Batch</SoTTh>
                <SoTTh align="right">Pending Rows</SoTTh>
                <SoTTh align="right">Auto-Reject</SoTTh>
                <SoTTh align="right">Pending Balance</SoTTh>
                <SoTTh align="right">Action</SoTTh>
              </SoTTableRow>
            </SoTTableHead>
            <tbody>
              {batches.length === 0 ? (
                <SoTTableEmptyRow colSpan={5} message="No pending opening balance batches." />
              ) : (
                batches.map((batch) => (
                  <SoTTableRow key={batch.batchRef}>
                    <SoTTd>
                      <div className="font-mono text-xs text-slate-800">
                        {batch.batchRef}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {batch.latestAt
                          ? `Latest ${new Date(batch.latestAt).toLocaleString()}`
                          : "No timestamp"}
                      </div>
                    </SoTTd>
                    <SoTTd align="right" className="tabular-nums">
                      {batch.pendingCount}
                    </SoTTd>
                    <SoTTd align="right" className="tabular-nums text-rose-700">
                      {batch.autoRejectCount}
                    </SoTTd>
                    <SoTTd align="right" className="tabular-nums font-semibold text-amber-700">
                      {peso(batch.pendingBalance)}
                    </SoTTd>
                    <SoTTd align="right">
                      <Link
                        to={`/store/clearance-opening-batches?batchRef=${encodeURIComponent(
                          batch.batchRef,
                        )}`}
                        className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                      >
                        Review Batch
                      </Link>
                    </SoTTd>
                  </SoTTableRow>
                ))
              )}
            </tbody>
          </SoTTable>
        </SoTCard>

        {activeBatchRef ? (
          <SoTCard className="overflow-hidden p-0">
            <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-800">
              Batch {activeBatchRef} ({selectedRows.length} pending row
              {selectedRows.length === 1 ? "" : "s"})
            </div>

            <Form method="post" className="space-y-3 p-4">
              <fieldset
                disabled={busy}
                className="space-y-3 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <input type="hidden" name="intent" value="approveValidRows" />
                <input type="hidden" name="batchRef" value={activeBatchRef} />

                {processingBusy ? (
                  <SoTLoadingState
                    variant="panel"
                    label="Processing opening balance batch"
                    hint="Approving valid rows and rejecting the selected exceptions."
                  />
                ) : null}

                <div className="text-xs text-slate-600">
                  Auto-reject rows are already marked and do not need manual selection.
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <SoTFormField label="Approval note">
                    <SoTInput
                      name="approveNote"
                      defaultValue="Opening balance batch approved."
                      maxLength={500}
                    />
                  </SoTFormField>
                  <SoTFormField label="Manual reject note (optional)">
                    <SoTInput
                      name="rejectNote"
                      placeholder="Reason for manually rejected rows"
                      maxLength={500}
                    />
                  </SoTFormField>
                </div>

                <SoTTable>
                  <SoTTableHead>
                    <SoTTableRow>
                      <SoTTh>Reject</SoTTh>
                      <SoTTh>Case</SoTTh>
                      <SoTTh>Customer</SoTTh>
                      <SoTTh align="right">Balance</SoTTh>
                      <SoTTh>Due/Ref</SoTTh>
                      <SoTTh>Auto Rule</SoTTh>
                    </SoTTableRow>
                  </SoTTableHead>
                  <tbody>
                    {selectedRows.length === 0 ? (
                      <SoTTableEmptyRow colSpan={6} message="No rows in selected batch." />
                    ) : (
                      selectedRows.map((row) => (
                      <SoTTableRow key={row.caseId}>
                          <SoTTd>
                            {row.autoRejectReason ? (
                              <span className="text-xs text-rose-700">auto</span>
                            ) : (
                              <input
                                type="checkbox"
                                name="rejectCaseIds"
                                value={row.caseId}
                                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                disabled={busy}
                              />
                            )}
                          </SoTTd>
                          <SoTTd>
                            <div className="font-mono text-xs">{row.receiptKey}</div>
                            <div className="text-[11px] text-slate-500">
                              Case #{row.caseId}
                            </div>
                          </SoTTd>
                          <SoTTd>
                            <div className="text-sm text-slate-800">{row.customerLabel}</div>
                            <div className="text-[11px] text-slate-500">
                              Customer #{row.customerId ?? "—"}
                            </div>
                          </SoTTd>
                          <SoTTd align="right" className="tabular-nums font-semibold text-amber-700">
                            {peso(row.balance)}
                          </SoTTd>
                          <SoTTd className="space-y-1 text-xs text-slate-600">
                            <div>
                              {row.dueDate ? `Due ${row.dueDate}` : "No due date"}
                              {row.refNo ? ` • Ref ${row.refNo}` : ""}
                            </div>
                            {row.lineNote ? <div>{row.lineNote}</div> : null}
                          </SoTTd>
                          <SoTTd className="text-xs">
                            {row.autoRejectReason ? (
                              <span className="text-rose-700">{row.autoRejectReason}</span>
                            ) : (
                              <span className="text-slate-500">valid</span>
                            )}
                          </SoTTd>
                        </SoTTableRow>
                      ))
                    )}
                  </tbody>
                </SoTTable>

                <div className="flex flex-wrap items-center gap-2">
                  <SoTButton type="submit" variant="primary" disabled={busy || !selectedRows.length}>
                    {processingBusy ? "Processing batch…" : "Approve Valid Rows"}
                  </SoTButton>
                </div>
              </fieldset>
            </Form>
          </SoTCard>
        ) : null}
      </div>
    </main>
  );
}
