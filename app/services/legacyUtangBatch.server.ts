export const LEGACY_RECEIPT_PREFIX = "LEGACY:";
const LEGACY_CASE_NOTE_META_PREFIX = "LEGACY_BATCH_META:";

export type LegacyBatchCaseMeta = {
  batchRef: string;
  lineNo: number;
  dueDate: string | null; // YYYY-MM-DD
  refNo: string | null;
  sourceLabel: string | null;
  lineNote: string | null;
};

export function normalizeLegacyBatchRef(input: string) {
  return String(input || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 48);
}

export function isLegacyReceiptKey(receiptKey: string | null | undefined) {
  return String(receiptKey || "").startsWith(LEGACY_RECEIPT_PREFIX);
}

export function extractLegacyBatchRefFromReceiptKey(
  receiptKey: string | null | undefined,
) {
  const raw = String(receiptKey || "");
  if (!raw.startsWith(LEGACY_RECEIPT_PREFIX)) return null;
  const parts = raw.split(":");
  const ref = String(parts[1] || "").trim();
  return ref || null;
}

export function buildLegacyReceiptKey(batchRef: string, lineNo: number) {
  const safeBatchRef = normalizeLegacyBatchRef(batchRef);
  const safeLineNo = Math.max(1, Math.floor(Number(lineNo) || 1));
  return `LEGACY:${safeBatchRef}:${String(safeLineNo).padStart(5, "0")}`;
}

export function encodeLegacyBatchCaseNote(
  meta: LegacyBatchCaseMeta,
  extraNote?: string | null,
) {
  const metaJson = JSON.stringify(meta);
  const cleanExtra = String(extraNote || "").trim();
  if (!cleanExtra) return `${LEGACY_CASE_NOTE_META_PREFIX}${metaJson}`;
  return `${LEGACY_CASE_NOTE_META_PREFIX}${metaJson}\n${cleanExtra}`;
}

export function decodeLegacyBatchCaseNote(note: string | null | undefined): {
  meta: LegacyBatchCaseMeta | null;
  extraNote: string | null;
} {
  const raw = String(note || "");
  if (!raw.startsWith(LEGACY_CASE_NOTE_META_PREFIX)) {
    return { meta: null, extraNote: raw || null };
  }

  const rest = raw.slice(LEGACY_CASE_NOTE_META_PREFIX.length);
  const newlineIdx = rest.indexOf("\n");
  const jsonPart = newlineIdx >= 0 ? rest.slice(0, newlineIdx) : rest;
  const extra = newlineIdx >= 0 ? rest.slice(newlineIdx + 1).trim() : "";

  try {
    const parsed = JSON.parse(jsonPart) as LegacyBatchCaseMeta;
    if (!parsed || typeof parsed !== "object") {
      return { meta: null, extraNote: extra || null };
    }
    return { meta: parsed, extraNote: extra || null };
  } catch {
    return { meta: null, extraNote: extra || null };
  }
}

export function parseDueDateISO(raw: string | null | undefined) {
  const v = String(raw || "").trim();
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const dt = new Date(`${v}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}
