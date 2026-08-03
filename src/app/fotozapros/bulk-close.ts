// Pure bulk-close helpers (no "use server") — shared by actions + tests + UI constants.

/** Default «старше N дней» — safer than close-all. */
export const BULK_CLOSE_DEFAULT_DAYS = 7;
/** Upper bound for olderThanDays (form / server). */
export const BULK_CLOSE_MAX_DAYS = 90;

/** Hidden confirm value — must match form POST (not a stray empty submit). */
export const BULK_CLOSE_CONFIRM_TOKEN = "CLOSE_PENDING";

export type BulkCloseScope = "older" | "all";

export type BulkCloseWhere = {
  status: "PENDING";
  createdAt?: { lt: Date };
};

/**
 * Pure: build updateMany where from scope + age.
 * Only PENDING; never touches DONE/CANCELLED.
 */
export function bulkCloseWhere(
  scope: BulkCloseScope,
  olderThanDays: number,
  now: Date = new Date(),
): BulkCloseWhere {
  if (scope === "all") {
    return { status: "PENDING" };
  }
  const days = Math.min(
    Math.max(1, Math.floor(olderThanDays)),
    BULK_CLOSE_MAX_DAYS,
  );
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { status: "PENDING", createdAt: { lt: cutoff } };
}

export type BulkCloseParseOk = {
  ok: true;
  scope: BulkCloseScope;
  olderThanDays: number;
};

export type BulkCloseParseFail = { ok: false; error: string };

/**
 * Pure form parse + intent guards (ack checkbox + confirm token).
 * Age default = BULK_CLOSE_DEFAULT_DAYS when scope=older and field empty/invalid.
 */
export function parseBulkCloseForm(
  formData: FormData,
): BulkCloseParseOk | BulkCloseParseFail {
  const confirm = String(formData.get("confirm") ?? "").trim();
  if (confirm !== BULK_CLOSE_CONFIRM_TOKEN) {
    return {
      ok: false,
      error: "Подтверждение не принято — откройте блок и отметьте галочку",
    };
  }
  const ack = String(formData.get("ack") ?? "").trim();
  if (ack !== "1" && ack !== "on" && ack !== "true") {
    return {
      ok: false,
      error: "Отметьте «Понимаю» — иначе закрытие не выполнится",
    };
  }

  const scopeRaw = String(formData.get("scope") ?? "").trim();
  let scope: BulkCloseScope;
  if (scopeRaw === "all") scope = "all";
  else if (scopeRaw === "older" || scopeRaw === "") scope = "older";
  else {
    return { ok: false, error: "Неизвестный режим закрытия" };
  }

  let olderThanDays = BULK_CLOSE_DEFAULT_DAYS;
  const daysRaw = String(formData.get("olderThanDays") ?? "").trim();
  if (daysRaw !== "") {
    if (!/^\d+$/.test(daysRaw)) {
      return { ok: false, error: "Число дней — целое положительное" };
    }
    const n = Number(daysRaw);
    if (!Number.isSafeInteger(n) || n < 1 || n > BULK_CLOSE_MAX_DAYS) {
      return {
        ok: false,
        error: `Число дней — от 1 до ${BULK_CLOSE_MAX_DAYS}`,
      };
    }
    olderThanDays = n;
  }

  return { ok: true, scope, olderThanDays };
}
