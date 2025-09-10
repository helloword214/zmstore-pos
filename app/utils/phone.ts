// PH phone helpers: normalize input and canonicalize to E.164 (+63…)
export function digitsOnly(s: string) {
  return (s || "").replace(/\D+/g, "");
}

// Return +63XXXXXXXXXX if possible; otherwise empty string.
export function toE164PH(input: string): string {
  const d = digitsOnly(input);
  if (!d) return "";
  if (d.length === 11 && d.startsWith("09")) return `+63${d.slice(1)}`;
  if ((d.length === 10 || d.length === 11) && d.startsWith("9"))
    return `+63${d}`;
  if (d.length === 12 && d.startsWith("639")) return `+${d}`;
  if (d.length === 13 && d.startsWith("0639")) return `+${d.slice(1)}`;
  return "";
}

// For substring/startsWith matching against stored E.164, convert partial user digits
// to a likely E.164 prefix (e.g. "0917" -> "+63917", "917" -> "+63917" when used as prefix).
export function toE164PrefixForContains(input: string): string {
  const d = digitsOnly(input);
  if (!d) return "";
  if (d.startsWith("09")) return `+63${d.slice(1)}`;
  if (d.startsWith("639")) return `+${d}`;
  if (d.startsWith("9")) return `+63${d}`;
  return "";
}
