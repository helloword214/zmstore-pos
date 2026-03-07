/* eslint-disable @typescript-eslint/no-explicit-any */
import * as React from "react";
import { Prisma } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { CustomerPicker } from "~/components/CustomerPicker";
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
import { digitsOnly, toE164PH } from "~/utils/phone";

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
  customerRefRaw: string;
  customerId: number | null;
  customerPhoneRaw: string | null;
  amount: number;
  dueDateRaw: string | null;
  refNo: string | null;
  lineNote: string | null;
  errors: string[];
};

type CustomerOption = {
  id: number;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  alias?: string | null;
  phone?: string | null;
};

type ComposerItemLine = {
  id: string;
  name: string;
  qty: string;
  unitAmount: string;
};

function sanitizeRowCell(input: string | null | undefined) {
  return String(input || "")
    .replace(/[\r\n\t|,]+/g, " ")
    .trim();
}

function parseMoneyInput(input: string | number | null | undefined) {
  const cleaned =
    typeof input === "number"
      ? String(input)
      : String(input || "").replace(/[^0-9.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function buildPhoneLookupCandidates(input: string) {
  const trimmed = String(input || "").trim();
  const out: string[] = [];
  const push = (value: string | null | undefined) => {
    const clean = String(value || "").trim();
    if (!clean || out.includes(clean)) return;
    out.push(clean);
  };

  if (!trimmed) return out;

  const digits = digitsOnly(trimmed);
  const e164 = toE164PH(trimmed);

  push(trimmed);
  push(digits);
  push(e164);

  if (e164.startsWith("+63")) {
    push(`0${e164.slice(3)}`);
    push(e164.slice(1));
  }

  if (digits.startsWith("63") && digits.length === 12) {
    push(`+${digits}`);
    push(`0${digits.slice(2)}`);
  }

  if (digits.startsWith("9") && digits.length === 10) {
    push(`0${digits}`);
    push(`+63${digits}`);
  }

  return out;
}

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

    const customerRefRaw = String(cols[0] || "").trim();
    const normalizedPhone = toE164PH(customerRefRaw);
    const customerIdNum = Number(customerRefRaw || 0);
    const customerId =
      !normalizedPhone &&
      Number.isFinite(customerIdNum) &&
      Math.floor(customerIdNum) === customerIdNum &&
      customerIdNum > 0
        ? customerIdNum
        : null;
    const customerPhoneRaw = normalizedPhone ? customerRefRaw : null;

    const amountRaw = String(cols[1] || "").replace(/[^0-9.-]/g, "");
    const amountParsed = Number(amountRaw);
    const amount = Number.isFinite(amountParsed) ? r2(amountParsed) : 0;

    const dueDateRaw = String(cols[2] || defaultDueDateRaw || "").trim() || null;
    const refNo = String(cols[3] || "").trim() || null;
    const lineNote =
      cols.length > 4 ? cols.slice(4).join(delimiter).trim() || null : null;

    const errors: string[] = [];
    if (!customerRefRaw) {
      errors.push("customerRef is required (customerId or phone).");
    } else if (!customerId && !customerPhoneRaw) {
      errors.push("customerRef must be a valid customerId or phone.");
    }
    if (!Number.isFinite(amount) || amount <= MONEY_EPS) {
      errors.push("amount must be greater than 0.");
    }
    if (dueDateRaw && !parseDueDateISO(dueDateRaw)) {
      errors.push("dueDate must be YYYY-MM-DD.");
    }

    drafts.push({
      lineNo,
      raw: trimmed,
      customerRefRaw,
      customerId,
      customerPhoneRaw,
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

  const phoneLookupValues = Array.from(
    new Set(
      drafts
        .map((row) => row.customerPhoneRaw)
        .filter((v): v is string => Boolean(v))
        .flatMap((phoneRaw) => buildPhoneLookupCandidates(phoneRaw)),
    ),
  );

  const phoneRows = phoneLookupValues.length
    ? await db.customer.findMany({
        where: {
          phone: {
            in: phoneLookupValues,
          },
        },
        select: { id: true, phone: true },
      })
    : [];

  const phoneToCustomerId = new Map<string, number>();
  for (const row of phoneRows) {
    if (!row.phone) continue;
    phoneToCustomerId.set(String(row.phone), Number(row.id));
  }

  for (const row of drafts) {
    if (!row.customerPhoneRaw) continue;

    const matchedCustomerIds = Array.from(
      new Set(
        buildPhoneLookupCandidates(row.customerPhoneRaw)
          .map((candidate) => phoneToCustomerId.get(candidate))
          .filter((id): id is number => Number.isFinite(id)),
      ),
    );

    if (matchedCustomerIds.length === 1) {
      row.customerId = matchedCustomerIds[0];
      continue;
    }

    if (matchedCustomerIds.length > 1) {
      row.errors.push(`customer phone ${row.customerPhoneRaw} matched multiple customers.`);
      continue;
    }

    row.errors.push(`customer phone ${row.customerPhoneRaw} not found.`);
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
    if (!row.customerId) {
      if (!row.errors.some((msg) => msg.includes("customer phone"))) {
        row.errors.push(
          `customerRef "${row.customerRefRaw || ""}" could not be resolved to an existing customer.`,
        );
      }
      continue;
    }

    if (!customerIdSet.has(Number(row.customerId))) {
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

  const validRows = drafts.filter((row) => row.errors.length === 0 && Number(row.customerId) > 0);
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

  const [rowsText, setRowsText] = React.useState("");
  const [composerCustomer, setComposerCustomer] = React.useState<CustomerOption | null>(null);
  const [composerAmount, setComposerAmount] = React.useState("");
  const [composerDueDate, setComposerDueDate] = React.useState("");
  const [composerRefNo, setComposerRefNo] = React.useState("");
  const [composerLineNote, setComposerLineNote] = React.useState("");
  const [composerItems, setComposerItems] = React.useState<ComposerItemLine[]>([]);
  const [composerError, setComposerError] = React.useState<string | null>(null);
  const composerItemSeqRef = React.useRef(1);

  const stagedRowCount = rowsText
    .split(/\r?\n/)
    .filter((line) => String(line || "").trim().length > 0).length;

  const makeComposerItemLine = React.useCallback((): ComposerItemLine => {
    const seq = composerItemSeqRef.current;
    composerItemSeqRef.current += 1;
    return {
      id: `item-${Date.now()}-${seq}`,
      name: "",
      qty: "1",
      unitAmount: "",
    };
  }, []);

  const addComposerItemLine = React.useCallback(() => {
    setComposerItems((prev) => [...prev, makeComposerItemLine()]);
    setComposerError(null);
  }, [makeComposerItemLine]);

  const removeComposerItemLine = React.useCallback((id: string) => {
    setComposerItems((prev) => prev.filter((line) => line.id !== id));
  }, []);

  const updateComposerItemLine = React.useCallback(
    (id: string, field: "name" | "qty" | "unitAmount", value: string) => {
      setComposerItems((prev) =>
        prev.map((line) =>
          line.id === id
            ? {
                ...line,
                [field]: value,
              }
            : line,
        ),
      );
      setComposerError(null);
    },
    [],
  );

  const itemizedPreviewTotal = React.useMemo(
    () =>
      r2(
        composerItems.reduce((sum, line) => {
          const qty = parseMoneyInput(line.qty);
          const unitAmount = parseMoneyInput(line.unitAmount);
          if (!Number.isFinite(qty) || qty <= MONEY_EPS) return sum;
          if (!Number.isFinite(unitAmount) || unitAmount < 0) return sum;
          return sum + r2(qty * unitAmount);
        }, 0),
      ),
    [composerItems],
  );

  const hasItemInputs = React.useMemo(
    () =>
      composerItems.some(
        (line) =>
          Boolean(sanitizeRowCell(line.name)) ||
          Boolean(String(line.qty || "").trim()) ||
          Boolean(String(line.unitAmount || "").trim()),
      ),
    [composerItems],
  );

  const resetComposerDraft = React.useCallback(() => {
    setComposerCustomer(null);
    setComposerAmount("");
    setComposerDueDate("");
    setComposerRefNo("");
    setComposerLineNote("");
    setComposerItems([]);
    setComposerError(null);
  }, []);

  const removeLastRow = React.useCallback(() => {
    setRowsText((prev) => {
      const rows = String(prev || "")
        .split(/\r?\n/)
        .map((row) => row.trim())
        .filter((row) => row.length > 0);
      if (!rows.length) return "";
      rows.pop();
      return rows.join("\n");
    });
  }, []);

  const clearAllRows = React.useCallback(() => {
    setRowsText("");
  }, []);

  const applyItemizedTotal = React.useCallback(() => {
    if (itemizedPreviewTotal > MONEY_EPS) {
      setComposerAmount(itemizedPreviewTotal.toFixed(2));
      setComposerError(null);
    }
  }, [itemizedPreviewTotal]);

  const appendComposerRow = React.useCallback(() => {
    if (!composerCustomer) {
      setComposerError("Select a customer before adding a row.");
      return;
    }

    const amountParsed = parseMoneyInput(composerAmount);
    const amount = Number.isFinite(amountParsed) ? r2(amountParsed) : Number.NaN;
    if (!Number.isFinite(amount) || amount <= MONEY_EPS) {
      setComposerError("Amount must be greater than 0.");
      return;
    }

    const dueDate = String(composerDueDate || "").trim();
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      setComposerError("Due date must be YYYY-MM-DD.");
      return;
    }

    const normalizedItems: Array<{
      name: string;
      qty: number;
      unitAmount: number;
      lineTotal: number;
    }> = [];
    for (const line of composerItems) {
      const name = sanitizeRowCell(line.name);
      const qtyRaw = String(line.qty || "").trim();
      const unitRaw = String(line.unitAmount || "").trim();
      const hasAnyInput = Boolean(name) || Boolean(qtyRaw) || Boolean(unitRaw);
      if (!hasAnyInput) continue;

      const qty = parseMoneyInput(qtyRaw);
      const unitAmount = parseMoneyInput(unitRaw);

      if (!name) {
        setComposerError("Item name is required when itemization is used.");
        return;
      }
      if (!Number.isFinite(qty) || qty <= MONEY_EPS) {
        setComposerError(`Item "${name}" must have qty greater than 0.`);
        return;
      }
      if (!Number.isFinite(unitAmount) || unitAmount < 0) {
        setComposerError(`Item "${name}" must have a valid unit amount.`);
        return;
      }

      normalizedItems.push({
        name,
        qty: r2(qty),
        unitAmount: r2(unitAmount),
        lineTotal: r2(qty * unitAmount),
      });
    }

    const itemizedNote = normalizedItems.length
      ? `Items: ${normalizedItems
          .map(
            (line) =>
              `${line.name} x${line.qty.toFixed(2)} @ ${line.unitAmount.toFixed(2)} = ${line.lineTotal.toFixed(2)}`,
          )
          .join("; ")}`
      : "";

    const combinedLineNote = sanitizeRowCell(
      [sanitizeRowCell(composerLineNote), itemizedNote].filter(Boolean).join(" | "),
    );

    const row = [
      String(composerCustomer.id),
      amount.toFixed(2),
      sanitizeRowCell(dueDate),
      sanitizeRowCell(composerRefNo),
      combinedLineNote,
    ].join(",");

    setRowsText((prev) => {
      const cleanPrev = String(prev || "").trim();
      return cleanPrev ? `${cleanPrev}\n${row}` : row;
    });

    setComposerAmount("");
    setComposerDueDate("");
    setComposerRefNo("");
    setComposerLineNote("");
    setComposerItems([]);
    setComposerError(null);
  }, [
    composerAmount,
    composerCustomer,
    composerDueDate,
    composerItems,
    composerLineNote,
    composerRefNo,
  ]);

  React.useEffect(() => {
    if (!actionData?.ok) return;
    setRowsText("");
    resetComposerDraft();
  }, [actionData, resetComposerDraft]);

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
          Encode per customer and submit one batch. First column accepts
          <span className="mx-1 font-mono">customerId</span>
          or
          <span className="mx-1 font-mono">phone</span>
          in CSV/tab/pipe rows:
          <span className="ml-1 font-mono">
            customerRef,amount,dueDate(YYYY-MM-DD),refNo,itemDetails
          </span>
          .
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
          <Form method="post" className="space-y-4">
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

            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <div>
                <h3 className="text-sm font-medium text-slate-900">Quick Add Row (Select Customer)</h3>
                <p className="text-xs text-slate-600">
                  Use this when encoding per customer. It appends rows directly to the batch textarea.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
                <div className="md:col-span-2">
                  <SoTFormField label="Customer">
                    <CustomerPicker
                      value={composerCustomer}
                      onChange={(c) => {
                        setComposerCustomer(c as CustomerOption | null);
                        setComposerError(null);
                      }}
                      placeholder="Search existing customer by name / alias / phone"
                    />
                  </SoTFormField>
                </div>

                <SoTFormField label="Amount">
                  <SoTInput
                    type="number"
                    min="0"
                    step="0.01"
                    value={composerAmount}
                    onChange={(e) => setComposerAmount(e.currentTarget.value)}
                    placeholder="1500"
                  />
                </SoTFormField>

                <SoTFormField label="Due Date (optional)">
                  <SoTInput
                    type="date"
                    value={composerDueDate}
                    onChange={(e) => setComposerDueDate(e.currentTarget.value)}
                  />
                </SoTFormField>

                <SoTFormField label="Reference No (optional)">
                  <SoTInput
                    value={composerRefNo}
                    onChange={(e) => setComposerRefNo(e.currentTarget.value)}
                    placeholder="BOOK1-P1"
                  />
                </SoTFormField>

                <div className="md:col-span-2 lg:col-span-2">
                  <SoTFormField label="Item Details / Note (optional)">
                    <SoTInput
                      value={composerLineNote}
                      onChange={(e) => setComposerLineNote(e.currentTarget.value)}
                      placeholder="Optional item list or open-balance context"
                    />
                  </SoTFormField>
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-900">Itemization (optional)</p>
                    <p className="text-xs text-slate-600">
                      Add item lines if record book has details. Leave empty for balance-only rows.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <SoTButton type="button" variant="secondary" size="compact" onClick={addComposerItemLine}>
                      Add Item Line
                    </SoTButton>
                    <SoTButton
                      type="button"
                      variant="secondary"
                      size="compact"
                      onClick={applyItemizedTotal}
                      disabled={itemizedPreviewTotal <= MONEY_EPS}
                    >
                      Use Itemized Total
                    </SoTButton>
                  </div>
                </div>

                {composerItems.length > 0 ? (
                  <div className="space-y-2">
                    {composerItems.map((line, idx) => {
                      const qty = parseMoneyInput(line.qty);
                      const unitAmount = parseMoneyInput(line.unitAmount);
                      const lineTotal =
                        Number.isFinite(qty) &&
                        qty > MONEY_EPS &&
                        Number.isFinite(unitAmount) &&
                        unitAmount >= 0
                          ? r2(qty * unitAmount)
                          : 0;

                      return (
                        <div
                          key={line.id}
                          className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 md:grid-cols-12"
                        >
                          <div className="md:col-span-5">
                            <SoTInput
                              value={line.name}
                              onChange={(e) =>
                                updateComposerItemLine(line.id, "name", e.currentTarget.value)
                              }
                              placeholder={`Item ${idx + 1}`}
                            />
                          </div>
                          <div className="md:col-span-2">
                            <SoTInput
                              type="number"
                              min="0"
                              step="0.01"
                              value={line.qty}
                              onChange={(e) =>
                                updateComposerItemLine(line.id, "qty", e.currentTarget.value)
                              }
                              placeholder="Qty"
                            />
                          </div>
                          <div className="md:col-span-2">
                            <SoTInput
                              type="number"
                              min="0"
                              step="0.01"
                              value={line.unitAmount}
                              onChange={(e) =>
                                updateComposerItemLine(line.id, "unitAmount", e.currentTarget.value)
                              }
                              placeholder="Unit"
                            />
                          </div>
                          <div className="md:col-span-2">
                            <div className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm leading-9 text-slate-700">
                              {lineTotal > 0 ? peso(lineTotal) : "—"}
                            </div>
                          </div>
                          <div className="md:col-span-1">
                            <SoTButton
                              type="button"
                              variant="danger"
                              size="compact"
                              className="w-full"
                              onClick={() => removeComposerItemLine(line.id)}
                            >
                              Remove
                            </SoTButton>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">No item lines added.</p>
                )}

                <div className="text-xs text-slate-600">
                  Itemized total preview: <span className="font-semibold text-slate-800">{peso(itemizedPreviewTotal)}</span>
                </div>
              </div>

              {composerError ? <SoTAlert tone="warning">{composerError}</SoTAlert> : null}

              <div className="flex flex-wrap items-center gap-2">
                <SoTButton type="button" variant="secondary" onClick={appendComposerRow}>
                  Add Row To Batch
                </SoTButton>
                <SoTButton type="button" variant="secondary" onClick={resetComposerDraft}>
                  Cancel Row Draft
                </SoTButton>
                <span className="text-xs text-slate-600">
                  Staged rows: <span className="font-semibold text-slate-800">{stagedRowCount}</span>
                </span>
                {hasItemInputs ? (
                  <span className="text-xs text-slate-600">Itemization attached</span>
                ) : null}
              </div>
            </div>

            <SoTFormField label="Rows">
              <textarea
                name="rowsText"
                rows={12}
                required
                value={rowsText}
                onChange={(e) => setRowsText(e.currentTarget.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-800 outline-none focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
                placeholder={[
                  "customerRef,amount,dueDate,refNo,itemDetails",
                  "101,1500,2026-03-20,BOOK1-P1,open balance from ledger",
                  "09171234567,420,,BOOK1-P2,",
                ].join("\n")}
              />
            </SoTFormField>

            <div className="flex flex-wrap items-center gap-2">
              <SoTButton type="submit" variant="primary" disabled={busy}>
                {busy ? "Submitting..." : "Submit Batch"}
              </SoTButton>
              <SoTButton
                type="button"
                variant="secondary"
                onClick={removeLastRow}
                disabled={stagedRowCount === 0}
              >
                Remove Last Row
              </SoTButton>
              <SoTButton
                type="button"
                variant="danger"
                onClick={clearAllRows}
                disabled={stagedRowCount === 0}
              >
                Clear All Rows
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
