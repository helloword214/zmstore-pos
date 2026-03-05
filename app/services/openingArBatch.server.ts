export const OPENING_AR_RECEIPT_PREFIX = "OPENING_AR:";
const OPENING_AR_BATCH_META_PREFIX = "OPENING_AR_BATCH_META:";

export type OpeningArBatchMeta = {
  batchRef: string;
  lineNo: number;
  dueDate: string | null; // YYYY-MM-DD
  refNo: string | null;
  sourceLabel: string | null;
  lineNote: string | null;
};

export function normalizeOpeningBatchRef(input: string) {
  return String(input || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 48);
}

export function isOpeningArReceiptKey(receiptKey: string | null | undefined) {
  return String(receiptKey || "").startsWith(OPENING_AR_RECEIPT_PREFIX);
}

export function extractOpeningBatchRefFromReceiptKey(
  receiptKey: string | null | undefined,
) {
  const raw = String(receiptKey || "");
  if (!raw.startsWith(OPENING_AR_RECEIPT_PREFIX)) return null;
  const parts = raw.split(":");
  const ref = String(parts[1] || "").trim();
  return ref || null;
}

export function buildOpeningArReceiptKey(batchRef: string, lineNo: number) {
  const safeBatchRef = normalizeOpeningBatchRef(batchRef);
  const safeLineNo = Math.max(1, Math.floor(Number(lineNo) || 1));
  return `OPENING_AR:${safeBatchRef}:${String(safeLineNo).padStart(5, "0")}`;
}

export function encodeOpeningBatchCaseNote(
  meta: OpeningArBatchMeta,
  extraNote?: string | null,
) {
  const metaJson = JSON.stringify(meta);
  const cleanExtra = String(extraNote || "").trim();
  if (!cleanExtra) return `${OPENING_AR_BATCH_META_PREFIX}${metaJson}`;
  return `${OPENING_AR_BATCH_META_PREFIX}${metaJson}\n${cleanExtra}`;
}

export function decodeOpeningBatchCaseNote(note: string | null | undefined): {
  meta: OpeningArBatchMeta | null;
  extraNote: string | null;
} {
  const raw = String(note || "");
  if (!raw.startsWith(OPENING_AR_BATCH_META_PREFIX)) {
    return { meta: null, extraNote: raw || null };
  }

  const rest = raw.slice(OPENING_AR_BATCH_META_PREFIX.length);
  const newlineIdx = rest.indexOf("\n");
  const jsonPart = newlineIdx >= 0 ? rest.slice(0, newlineIdx) : rest;
  const extra = newlineIdx >= 0 ? rest.slice(newlineIdx + 1).trim() : "";

  try {
    const parsed = JSON.parse(jsonPart) as OpeningArBatchMeta;
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
