// TZ №10+11 — справочники Client / Site: SOF helpers + phone dedup.
// Scope mirrors reservationListScope (owner all / manager own).
// Money totals NEVER mix UZS and USD (TZ «Правки модели» §5 / CONTRACT).

/**
 * Local string-union mirrors of Prisma enums — no @prisma/client import
 * so this module stays unit-testable without a generated client.
 */
export type ClientType = "B2C" | "B2B";
export type SiteType = "RESIDENTIAL" | "COMMERCIAL" | "OTHER";
export type SiteStatus = "ACTIVE" | "COMPLETED";
export type MoneyCurrency = "UZS" | "USD";

export const CLIENT_TYPES: readonly ClientType[] = ["B2C", "B2B"] as const;
export const SITE_TYPES: readonly SiteType[] = [
  "RESIDENTIAL",
  "COMMERCIAL",
  "OTHER",
] as const;
export const SITE_STATUSES: readonly SiteStatus[] = [
  "ACTIVE",
  "COMPLETED",
] as const;

/** RU labels for UI (этап 3 / форма продажи). Codes stay EN in DB. */
export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  B2C: "Частный",
  B2B: "Компания",
};

export const SITE_TYPE_LABELS: Record<SiteType, string> = {
  RESIDENTIAL: "Жилой",
  COMMERCIAL: "Коммерческий",
  OTHER: "Другое",
};

export const SITE_STATUS_LABELS: Record<SiteStatus, string> = {
  ACTIVE: "Активен",
  COMPLETED: "Завершён",
};

/**
 * List filter for Client / Site directories (TZ §7 / §12):
 * canSeeAllClients → no manager filter (owner);
 * else → only rows where managerId = actorId;
 * no actor → impossible id (never leak other managers' clients).
 *
 * Spread into Prisma `where`: `{ ...clientListScope(args) }`.
 */
export function clientListScope(args: {
  canSeeAllClients: boolean;
  actorId: string | null;
}): { managerId?: string } {
  if (args.canSeeAllClients) return {};
  if (args.actorId) return { managerId: args.actorId };
  return { managerId: "__no_actor__" };
}

/** Same scope rules for Site (manager who created the site). */
export function siteListScope(args: {
  canSeeAllClients: boolean;
  actorId: string | null;
}): { managerId?: string } {
  return clientListScope(args);
}

/**
 * Normalize phone for duplicate checks (этап 2): keep digits only.
 * Empty after strip → "".
 * `+998 90 123-45-67` and `998901234567` → same key.
 */
export function normalizeClientPhone(raw: string): string {
  return raw.replace(/\D+/g, "");
}

/** True when both phones normalize to the same non-empty digit string. */
export function phonesMatch(a: string, b: string): boolean {
  const na = normalizeClientPhone(a);
  const nb = normalizeClientPhone(b);
  return na.length > 0 && na === nb;
}

/**
 * Soft dedup (TZ §9 п.1 / §10): find first client whose phone matches
 * when compared in normalized form. Pure — no DB.
 */
export function findClientByNormalizedPhone<
  T extends { phone: string },
>(candidates: readonly T[], phone: string): T | null {
  const key = normalizeClientPhone(phone);
  if (!key) return null;
  return (
    candidates.find((c) => normalizeClientPhone(c.phone) === key) ?? null
  );
}

export type CurrencyMoney = {
  currency: MoneyCurrency;
  /** Decimal string, 2 places (cent-safe). */
  amount: string;
  count: number;
};

/** Parse decimal string → integer cents (BigInt). Invalid → 0n. */
export function moneyToCents(amount: string): bigint {
  const s = amount.trim().replace(",", ".");
  const m = /^(-?)(\d+)(?:\.(\d{0,2})\d*)?$/.exec(s);
  if (!m) return 0n;
  const neg = m[1] === "-";
  const whole = BigInt(m[2] || "0");
  const frac = BigInt(((m[3] ?? "") + "00").slice(0, 2));
  const cents = whole * 100n + frac;
  return neg ? -cents : cents;
}

export function centsToMoney(cents: bigint): string {
  const neg = cents < 0n;
  const a = neg ? -cents : cents;
  const whole = a / 100n;
  const frac = a % 100n;
  const body = `${whole.toString()}.${frac.toString().padStart(2, "0")}`;
  return neg ? `-${body}` : body;
}

/**
 * Sum money rows per currency. UZS and USD are NEVER added together —
 * each currency gets its own total (TZ model corrections §5).
 */
export function sumMoneyByCurrency(
  rows: ReadonlyArray<{ amount: string; currency: MoneyCurrency }>,
): CurrencyMoney[] {
  const acc = new Map<MoneyCurrency, { cents: bigint; count: number }>();
  for (const r of rows) {
    const prev = acc.get(r.currency) ?? { cents: 0n, count: 0 };
    prev.cents += moneyToCents(r.amount);
    prev.count += 1;
    acc.set(r.currency, prev);
  }
  const out: CurrencyMoney[] = [];
  for (const cur of ["UZS", "USD"] as const) {
    const row = acc.get(cur);
    if (!row || row.count === 0) continue;
    out.push({
      currency: cur,
      amount: centsToMoney(row.cents),
      count: row.count,
    });
  }
  return out;
}

/** Type guards matching Prisma enums (model contract tests). */
export function isClientType(v: string): v is ClientType {
  return (CLIENT_TYPES as readonly string[]).includes(v);
}

export function isSiteType(v: string): v is SiteType {
  return (SITE_TYPES as readonly string[]).includes(v);
}

export function isSiteStatus(v: string): v is SiteStatus {
  return (SITE_STATUSES as readonly string[]).includes(v);
}
