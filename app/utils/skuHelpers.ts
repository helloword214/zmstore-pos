export function generateSKU({
  category,
  brand,
  name,
  id,
}: {
  category?: string;
  brand?: string;
  name?: string;
  id?: number | string; // Optionally include the product ID
}) {
  // 1) Cat: first 3 alphanumeric chars of category
  const cat = (category || "")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 3)
    .toUpperCase();

  // 2) Br: first 3 alphanumeric chars of brand
  const br = (brand || "")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 3)
    .toUpperCase();

  // 3) Nm: initials of first 3 words of name, or first 3 letters if fewer words
  let nm = "";
  const words = (name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 3) {
    nm = words
      .slice(0, 3)
      .map((w) => w[0])
      .join("");
  } else if (words.length > 0) {
    // take first letters of whatever words you have
    nm = words.map((w) => w[0]).join("");
    // if still under 3 chars, pad from the raw name
    const fallback = (name || "").replace(/[^A-Za-z0-9]/g, "");
    while (nm.length < 3 && nm.length < fallback.length) {
      nm += fallback[nm.length];
    }
  }
  nm = nm.toUpperCase().padEnd(3, "X"); // ensure length 3

  // 4) ID suffix: zero-pad to 3 or 4 digits as you like
  const suffix =
    id != null
      ? String(id).padStart(3, "0") // e.g. “007”
      : Math.floor(100 + Math.random() * 900).toString(); // fallback

  // Combine
  return [cat, br, nm].filter(Boolean).join("-") + `-${suffix}`;
}
