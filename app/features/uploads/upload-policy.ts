const IMAGE_UPLOAD_MIME_SET = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const EMPLOYEE_DOC_UPLOAD_MIME_SET = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const MAX_PRODUCT_PHOTO_SLOTS = 4;

function sanitizePathToken(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function resolveUploadSessionKey(rawValue: string | null | undefined) {
  const safeToken = sanitizePathToken(String(rawValue ?? "")).slice(0, 48);
  return safeToken || null;
}

export function createUploadSessionKey() {
  const seed = `up-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  return resolveUploadSessionKey(seed) ?? `up-${Date.now().toString(36)}`;
}

export function normalizeProductPhotoSlot(rawValue: string | number | null | undefined) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return null;
  const slot = Math.floor(parsed);
  if (slot < 1 || slot > MAX_PRODUCT_PHOTO_SLOTS) return null;
  return slot;
}

export function resolveMaxUploadMb(rawValue: string | undefined, fallbackMb: number) {
  const parsed = Number.parseFloat(String(rawValue ?? "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return Math.max(1, fallbackMb);
  }
  return Math.max(1, parsed);
}

export function mbToBytes(maxMb: number) {
  return Math.max(1, Math.floor(maxMb * 1024 * 1024));
}

export function readOptionalUpload(raw: FormDataEntryValue | null): File | null {
  if (!(raw instanceof File)) return null;
  if (!raw.size) return null;
  return raw;
}

export function validateImageUpload(file: File, maxMb: number) {
  if (!IMAGE_UPLOAD_MIME_SET.has(file.type)) {
    return "Only JPG, PNG, and WEBP files are allowed.";
  }
  if (file.size > mbToBytes(maxMb)) {
    return `File is too large. Limit is ${maxMb}MB.`;
  }
  return null;
}

export function validateEmployeeDocumentUpload(file: File, maxMb: number) {
  if (!EMPLOYEE_DOC_UPLOAD_MIME_SET.has(file.type)) {
    return "Only PDF, JPG, PNG, and WEBP files are allowed.";
  }
  if (file.size > mbToBytes(maxMb)) {
    return `File is too large. Limit is ${maxMb}MB.`;
  }
  return null;
}

export const uploadKeyPrefix = {
  customerProfile(customerId: number) {
    return `customers/${customerId}/profile`;
  },
  customerAddressPhoto(customerId: number, addressId: number) {
    return `customers/${customerId}/addresses/${addressId}/photos`;
  },
  employeeDocument(employeeId: number, docType: string) {
    const safeDocType = sanitizePathToken(docType) || "other";
    return `employees/${employeeId}/documents/${safeDocType}`;
  },
  productImage({
    productId,
    uploadSessionKey,
  }: {
    productId?: number | null;
    uploadSessionKey?: string | null;
  }) {
    if (Number.isFinite(productId) && Number(productId) > 0) {
      return `products/${Math.floor(Number(productId))}/primary`;
    }
    const safeSessionKey =
      resolveUploadSessionKey(uploadSessionKey) ?? createUploadSessionKey();
    return `products/draft/${safeSessionKey}/primary`;
  },
  productPhotoSlot({
    productId,
    uploadSessionKey,
    slot,
  }: {
    productId?: number | null;
    uploadSessionKey?: string | null;
    slot: number;
  }) {
    const safeSlot = normalizeProductPhotoSlot(slot) ?? 1;
    if (Number.isFinite(productId) && Number(productId) > 0) {
      return `products/${Math.floor(Number(productId))}/images/slot-${safeSlot}`;
    }
    const safeSessionKey =
      resolveUploadSessionKey(uploadSessionKey) ?? createUploadSessionKey();
    return `products/draft/${safeSessionKey}/images/slot-${safeSlot}`;
  },
};
