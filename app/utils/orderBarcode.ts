// app/utils/orderBarcode.ts
// Minimal Code 39 SVG generator for order slips.
// Supports: 0-9 A-Z - . space $ / + %
// Reference: Each character = 9 elements (bar/space alternating), 3 are wide.
// Pattern string uses 'n' (narrow) and 'w' (wide), starting with a BAR.

const CODE39_MAP: Record<string, string> = {
  "0": "nnnwwnwnw",
  "1": "wnnwnnnnw",
  "2": "nnwwnnnnw",
  "3": "wnwwnnnnn",
  "4": "nnnwwnnnw",
  "5": "wnnwwnnnn",
  "6": "nnwwwnnnn",
  "7": "nnnwnnwnw",
  "8": "wnnwnnwnn",
  "9": "nnwwnnwnn",
  A: "wnnnnwnnw",
  B: "nnwnnwnnw",
  C: "wnwnnwnnn",
  D: "nnnnwwnnw",
  E: "wnnnwwnnn",
  F: "nnwnwwnnn",
  G: "nnnnnwwnw",
  H: "wnnnnwwnn",
  I: "nnwnnwwnn",
  J: "nnnnwwwnn",
  K: "wnnnnnnww",
  L: "nnwnnnnww",
  M: "wnwnnnnwn",
  N: "nnnnwnnww",
  O: "wnnnwnnwn",
  P: "nnwnwnnwn",
  Q: "nnnnnnwww",
  R: "wnnnnnwwn",
  S: "nnwnnnwwn",
  T: "nnnnwnwwn",
  U: "wwnnnnnnw",
  V: "nwwnnnnnw",
  W: "wwwnnnnnn",
  X: "nwnnwnnnw",
  Y: "wwnnwnnnn",
  Z: "nwwnwnnnn",
  "-": "nwnnnnwnw",
  ".": "wwnnnnwnn",
  " ": "nwwnnnwnn",
  $: "nwnwnwnnn",
  "/": "nwnwnnnwn",
  "+": "nwnnnwnwn",
  "%": "nnnwnwnwn",
  "*": "nwnnwnwnn", // START/STOP
};

export type Code39Options = {
  height?: number; // bar height (px)
  narrow?: number; // narrow bar width (px)
  wide?: number; // wide bar width (px) ~ 2.5–3 × narrow
  margin?: number; // horizontal margin (px)
  showText?: boolean; // render human-readable text
  className?: string; // optional class for the <svg>
};

export function toCode39Svg(rawText: string, opts: Code39Options = {}): string {
  const {
    height = 48,
    narrow = 2,
    wide = 5,
    margin = 8,
    showText = true,
    className = "",
  } = opts;

  // Uppercase + validate chars
  const text = `*${(rawText ?? "").toString().toUpperCase()}*`;
  for (const ch of text) {
    if (!CODE39_MAP[ch]) {
      throw new Error(`Code39: unsupported character "${ch}"`);
    }
  }

  // Build bars
  let x = margin;
  const gap = narrow; // gap between characters (narrow space)
  const rects: string[] = [];

  const charWidth = (pattern: string) => {
    // 9 elements alternating bar/space
    let w = 0;
    for (let i = 0; i < pattern.length; i++) {
      const isBar = i % 2 === 0;
      const ww = pattern[i] === "w" ? wide : narrow;
      w += ww;
    }
    return w;
  };

  let totalWidth = margin * 2 + (text.length - 1) * gap;
  for (const ch of text) {
    totalWidth += charWidth(CODE39_MAP[ch]);
  }

  for (let c = 0; c < text.length; c++) {
    const pattern = CODE39_MAP[text[c]];
    for (let i = 0; i < pattern.length; i++) {
      const isBar = i % 2 === 0;
      const w = pattern[i] === "w" ? wide : narrow;
      if (isBar) {
        rects.push(`<rect x="${x}" y="0" width="${w}" height="${height}" />`);
      }
      x += w;
    }
    if (c < text.length - 1) x += gap; // char separator
  }

  const svgAttrs = [
    `xmlns="http://www.w3.org/2000/svg"`,
    `width="${totalWidth}"`,
    `height="${showText ? height + 16 : height}"`,
    `viewBox="0 0 ${totalWidth} ${showText ? height + 16 : height}"`,
    className ? `class="${className}"` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const bars = `<g fill="currentColor">${rects.join("")}</g>`;
  const label = showText
    ? `<text x="${totalWidth / 2}" y="${
        height + 12
      }" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12">${rawText}</text>`
    : "";

  return `<svg ${svgAttrs} role="img" aria-label="Order code ${rawText}">${bars}${label}</svg>`;
}
