// Structural guard against silent form errors (sweep tz1415 / round2).
// History: sale qty on confirm (e1d5c00), sample step-4 (TZ14 BUG-01) — each
// fixed only at the call site. Root shape: action returns a key the submit
// step never renders → user thinks the button is dead.
//
// Contract:
//   leftoverErrorMessages — keys not claimed by any rendered field/list
//   orderedErrorMessages  — preferred order first, then leftovers (deduped)
//   ensureFormError       — server second net: always set errors.form

/**
 * Messages for error keys that no input / whitelist claimed.
 * Empty or whitespace-only values are ignored.
 */
export function leftoverErrorMessages(
  errors: Readonly<Record<string, string | undefined>>,
  renderedKeys: ReadonlySet<string> | readonly string[],
): string[] {
  const rendered =
    renderedKeys instanceof Set
      ? renderedKeys
      : new Set(renderedKeys);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const [key, raw] of Object.entries(errors)) {
    if (rendered.has(key)) continue;
    const msg = typeof raw === "string" ? raw.trim() : "";
    if (!msg || seen.has(msg)) continue;
    seen.add(msg);
    out.push(msg);
  }
  return out;
}

/**
 * Stable UI list: preferred keys in given order, then any leftover keys
 * (unknown / future validators) so allowlist drift cannot go silent.
 * Message-deduped (form often mirrors the first field error).
 */
export function orderedErrorMessages(
  errors: Readonly<Record<string, string | undefined>>,
  preferredKeys: readonly string[],
): string[] {
  const preferred = new Set(preferredKeys);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const key of preferredKeys) {
    const raw = errors[key];
    const msg = typeof raw === "string" ? raw.trim() : "";
    if (!msg || seen.has(msg)) continue;
    seen.add(msg);
    out.push(msg);
  }
  for (const msg of leftoverErrorMessages(errors, preferred)) {
    if (seen.has(msg)) continue;
    seen.add(msg);
    out.push(msg);
  }
  return out;
}

/**
 * Server-side second net (pattern of obraztsy failFields): if any field
 * error exists and `form` is missing, set `form` to the first message so a
 * step that only renders `errors.form` still shows something.
 * Mutates and returns the same object for convenience at return sites.
 */
export function ensureFormError(
  errors: Record<string, string>,
  fallback = "Проверьте поля формы",
): Record<string, string> {
  if (Object.keys(errors).length === 0) return errors;
  if (errors.form?.trim()) return errors;
  const first =
    Object.values(errors).find((v) => typeof v === "string" && v.trim()) ??
    fallback;
  errors.form = first;
  return errors;
}
