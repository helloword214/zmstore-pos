// app/utils/barcode.ts
export function ean13CheckDigit(base12: string): number {
  if (!/^\d{12}$/.test(base12)) throw new Error("EAN-13 needs 12 digits");
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = base12.charCodeAt(i) - 48; // '0' -> 48
    sum += i % 2 === 0 ? d : d * 3; // index 0 is position 1 (odd)
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Reserved EAN-13 range 20–29 is OK for in-store numbers.
 * We’ll use "29" + 2-digit STORE_CODE + 8 random digits + checksum.
 */
export function makeLocalEan13(storeCode = "00", prefix = "29"): string {
  const sc = String(storeCode).padStart(2, "0").slice(0, 2);
  const rnd = Math.floor(Math.random() * 1e8)
    .toString()
    .padStart(8, "0");
  const base12 = `${prefix}${sc}${rnd}`;
  const cd = ean13CheckDigit(base12);
  return base12 + String(cd);
}
