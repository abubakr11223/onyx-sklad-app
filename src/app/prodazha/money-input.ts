// Price input: group for humans, submit digits for validators.
//
// Grouping matches the rest of the app (ru-RU / debts-ui formatDebtMoney):
// thousands separated by space, e.g. «200 007 666». We intentionally do NOT
// use a dot as the thousands separator — it collides with decimal input
// (13400.50) and with locale-decimal comma after normalize.
//
// CRITICAL: sale-payment / parseBoundedDecimal reject internal spaces
// (same class of bug as volume-qty «55 12.5»). Display may contain spaces;
// the value POSTed as name="price" must be normalizeMoneyForSubmit(display).

/** All whitespace used as group separators (typed space + Intl NBSPs). */
const GROUP_SPACE = /[\s\u00A0\u202F\u2009]/g;

/**
 * Strip grouping and normalize to a single "." decimal for the validator.
 * Empty / only junk → "".
 */
export function normalizeMoneyForSubmit(display: string): string {
  const s = display.trim().replace(GROUP_SPACE, "");
  if (s === "") return "";
  // Allow one decimal separator: last , or . wins as decimal point.
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  const decAt = Math.max(lastComma, lastDot);
  let intPart: string;
  let fracPart: string | null = null;
  if (decAt >= 0) {
    intPart = s.slice(0, decAt).replace(/[^\d]/g, "");
    fracPart = s.slice(decAt + 1).replace(/[^\d]/g, "");
  } else {
    intPart = s.replace(/[^\d]/g, "");
  }
  // Drop leading zeros on integer part but keep a single 0 before decimal.
  intPart = intPart.replace(/^0+(?=\d)/, "");
  if (intPart === "" && fracPart !== null) intPart = "0";
  if (fracPart !== null) {
    // Cap fraction at 2 digits (Decimal scale 2). Trailing separator alone
    // ("13400,") → submit integer only so parseBoundedDecimal accepts it.
    fracPart = fracPart.slice(0, 2);
    return fracPart.length > 0 ? `${intPart}.${fracPart}` : intPart;
  }
  return intPart;
}

/**
 * Group integer digits with regular spaces (same visual as debts-ui / ru-RU).
 * Preserves a trailing decimal separator while the user is typing "13400,".
 */
export function formatMoneyGrouped(displayOrRaw: string): string {
  const raw = displayOrRaw.trim();
  if (raw === "") return "";

  // Detect trailing separator before stripping (user mid-decimal entry).
  const endsWithSep = /[.,]$/.test(raw.replace(GROUP_SPACE, ""));

  const submit = normalizeMoneyForSubmit(raw);
  if (submit === "" || submit === ".") return endsWithSep ? "0," : "";

  // normalizeMoneyForSubmit uses "."; map display decimal to comma (ru-RU).
  const hadDecimal = submit.includes(".");
  const [intRaw, frac = ""] = submit.replace(/\.$/, "").split(".");
  const intDigits = intRaw === "" ? "0" : intRaw;
  const grouped = intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");

  if (endsWithSep && !frac) {
    return `${grouped},`;
  }
  if (hadDecimal && (frac.length > 0 || submit.endsWith("."))) {
    return frac.length > 0 ? `${grouped},${frac}` : `${grouped},`;
  }
  return grouped;
}

/**
 * Count “significant” chars left of caret: digits + at most one decimal mark.
 * Used to restore caret after re-grouping.
 */
export function countSignificantLeft(value: string, caret: number): number {
  const left = value.slice(0, Math.max(0, caret));
  let n = 0;
  let seenDec = false;
  for (const ch of left) {
    if (ch >= "0" && ch <= "9") n += 1;
    else if ((ch === "." || ch === ",") && !seenDec) {
      seenDec = true;
      n += 1;
    }
  }
  return n;
}

/** Place caret in `formatted` after `significantCount` significant characters. */
export function caretFromSignificant(
  formatted: string,
  significantCount: number,
): number {
  if (significantCount <= 0) return 0;
  let n = 0;
  let seenDec = false;
  for (let i = 0; i < formatted.length; i++) {
    const ch = formatted[i];
    if (ch >= "0" && ch <= "9") n += 1;
    else if ((ch === "." || ch === ",") && !seenDec) {
      seenDec = true;
      n += 1;
    }
    if (n >= significantCount) return i + 1;
  }
  return formatted.length;
}

export interface MoneyInputChangeResult {
  /** Grouped string for the controlled input. */
  display: string;
  /** Digits (+ optional . frac) for name="price" / validators. */
  submit: string;
  /** New caret index in `display`. */
  caret: number;
}

/**
 * Apply a raw onChange value + selectionStart → grouped display + caret.
 */
export function applyMoneyInputChange(
  nextRaw: string,
  selectionStart: number | null,
): MoneyInputChangeResult {
  const caretIn = selectionStart ?? nextRaw.length;
  const sig = countSignificantLeft(nextRaw, caretIn);
  const display = formatMoneyGrouped(nextRaw);
  const submit = normalizeMoneyForSubmit(display);
  const caret = caretFromSignificant(display, sig);
  return { display, submit, caret };
}
