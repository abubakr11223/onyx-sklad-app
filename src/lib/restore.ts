// Zaxiradan TIKLASH — sof qism (DB'siz, unit-testlanadi).
//
// Juftlik: `db-snapshot.ts` yozadi, shu modul o'qishga tayyorlaydi. Ular birga
// «ma'lumot yo'qolmasin» kafolatini beradi — nusxa bo'lgani yetmaydi, uni
// QAYTARIB QO'YA olish ham kerak, va buni birinchi marta falokat kunida emas,
// bugun sinab ko'rish kerak.
//
// Ikki qiyinchilikni yechadi:
//
// 1) TARTIB. Jadvallar bir-biriga tashqi kalit bilan bog'langan: bola yozuvni
//    ota yozuvdan oldin qo'yib bo'lmaydi. RESTORE_ORDER — ana shu tartib
//    (sxemadagi @relation grafigidan qo'lda chiqarilgan, test uni snapshot
//    ro'yxati bilan solishtiradi).
//
// 2) HALQA. Slab.photoRequestId → PhotoRequest, PhotoRequest.slabId → Slab:
//    ikkalasi bir-biriga qaraydi, ya'ni qaysi biri birinchi bo'lsa ham yiqiladi.
//    Yechim — ikki bosqich: avval Slab shu ustunsiz (null) qo'yiladi, keyin
//    PhotoRequest, oxirida Slab.photoRequestId UPDATE bilan tiklanadi.

import { SNAPSHOT_TABLES, type Snapshot } from "./db-snapshot";

/** Otadan bolaga — tashqi kalitlar buzilmaydigan qo'yish tartibi. */
export const RESTORE_ORDER = [
  "appConfig",
  "user",
  "warehouseBlock",
  "warehouseLandmark",
  "kartaCell",
  "client",
  "site",
  "stoneType",
  "batch",
  "batchPattern",
  "batchLocation",
  "slab",
  "piece",
  "photoRequest",
  "photoDispatch",
  "photo",
  "reservation",
  "saleRecord",
  "sample",
  "shipment",
  "shipmentLine",
  "showroomPlacement",
  "debt",
  "lead",
  "telegramAccessRequest",
  "auditLog",
] as const;

export type RestoreTable = (typeof RESTORE_ORDER)[number];

/**
 * Birinchi bosqichda TASHLAB ketiladigan (keyin UPDATE bilan qo'yiladigan)
 * ustunlar — halqani uzish uchun. Jadval → ustunlar.
 */
export const DEFERRED_FIELDS: Record<string, string[]> = {
  slab: ["photoRequestId"],
};

export interface RestoreStep {
  table: string;
  count: number;
  /** Shu jadvalda keyinga qoldiriladigan ustunlar (bo'sh bo'lishi mumkin). */
  deferred: string[];
}

export interface RestorePlan {
  takenAt: string;
  steps: RestoreStep[];
  total: number;
  /** Snapshot'da bor, lekin tartibda yo'q jadvallar (sxema o'zgargan bo'lsa). */
  unknownTables: string[];
  /** Keyingi bosqichda qo'yiladigan yozuvlar soni. */
  deferredRows: number;
}

export type ParseResult =
  | { ok: true; snapshot: Snapshot }
  | { ok: false; error: string };

/**
 * JSON matnni tekshirib Snapshot'ga aylantiradi. Yaroqsiz fayl bilan bazaga
 * tegmaymiz: xato aniq matn bilan qaytadi (CLI uni chiqaradi va to'xtaydi).
 */
export function parseSnapshotJson(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `JSON o'qilmadi: ${(e as Error).message}` };
  }
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "Fayl ichida obyekt yo'q." };
  }
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) {
    return { ok: false, error: `Noma'lum format versiyasi: ${String(o.version)}` };
  }
  if (typeof o.takenAt !== "string" || o.takenAt.length < 10) {
    return { ok: false, error: "takenAt (olingan vaqt) yo'q yoki noto'g'ri." };
  }
  if (typeof o.rows !== "object" || o.rows === null) {
    return { ok: false, error: "rows (yozuvlar) yo'q." };
  }
  const rows = o.rows as Record<string, unknown>;
  for (const [table, value] of Object.entries(rows)) {
    if (!Array.isArray(value)) {
      return { ok: false, error: `«${table}» massiv emas.` };
    }
  }
  const counts =
    typeof o.counts === "object" && o.counts !== null
      ? (o.counts as Record<string, number>)
      : {};
  return {
    ok: true,
    snapshot: {
      version: 1,
      takenAt: o.takenAt,
      counts,
      rows: rows as Record<string, unknown[]>,
    },
  };
}

/** Nima qo'yilishini oldindan ko'rsatadigan reja (dry-run shu bilan chiqadi). */
export function planRestore(snapshot: Snapshot): RestorePlan {
  const known = new Set<string>(RESTORE_ORDER);
  const steps: RestoreStep[] = [];
  let total = 0;
  let deferredRows = 0;

  for (const table of RESTORE_ORDER) {
    const rows = snapshot.rows[table] ?? [];
    const deferred = DEFERRED_FIELDS[table] ?? [];
    if (deferred.length > 0) {
      deferredRows += rows.filter((r) =>
        deferred.some((f) => (r as Record<string, unknown>)[f] != null),
      ).length;
    }
    steps.push({ table, count: rows.length, deferred });
    total += rows.length;
  }

  const unknownTables = Object.keys(snapshot.rows).filter((t) => !known.has(t));
  return { takenAt: snapshot.takenAt, steps, total, unknownTables, deferredRows };
}

/**
 * Yozuvni ikkiga ajratadi: birinchi bosqichda qo'yiladigan qism (halqali
 * ustunlar null qilingan) va keyin UPDATE qilinadigan qiymatlar.
 * Yozuvda `id` bo'lmasa — keyinga qoldirish imkonsiz, shunda ustun tushib
 * qoladi va buni chaqiruvchi `skipped` orqali ko'radi.
 */
export function splitDeferred(
  table: string,
  rows: unknown[],
): {
  base: Record<string, unknown>[];
  updates: { id: string; data: Record<string, unknown> }[];
  skipped: number;
} {
  const fields = DEFERRED_FIELDS[table] ?? [];
  if (fields.length === 0) {
    return { base: rows as Record<string, unknown>[], updates: [], skipped: 0 };
  }
  const base: Record<string, unknown>[] = [];
  const updates: { id: string; data: Record<string, unknown> }[] = [];
  let skipped = 0;

  for (const row of rows as Record<string, unknown>[]) {
    const copy: Record<string, unknown> = { ...row };
    const data: Record<string, unknown> = {};
    for (const f of fields) {
      if (copy[f] != null) data[f] = copy[f];
      copy[f] = null;
    }
    base.push(copy);
    if (Object.keys(data).length > 0) {
      const id = typeof row.id === "string" ? row.id : null;
      if (id) updates.push({ id, data });
      else skipped += 1;
    }
  }
  return { base, updates, skipped };
}

/** Odam o'qiydigan reja — CLI shuni chiqaradi va tasdiq so'raydi. */
export function formatRestorePlan(plan: RestorePlan): string {
  const lines = [
    `Zaxira sanasi: ${plan.takenAt}`,
    `Jami yozuv: ${plan.total}`,
    "",
    "Jadval bo'yicha (qo'yish tartibida):",
  ];
  for (const s of plan.steps) {
    if (s.count === 0) continue;
    const tail = s.deferred.length > 0 ? `  (keyinga: ${s.deferred.join(", ")})` : "";
    lines.push(`  ${s.table.padEnd(24)} ${String(s.count).padStart(7)}${tail}`);
  }
  if (plan.deferredRows > 0) {
    lines.push("", `Ikkinchi bosqichda tiklanadigan bog'lam: ${plan.deferredRows}`);
  }
  if (plan.unknownTables.length > 0) {
    lines.push(
      "",
      `⚠️  Zaxirada notanish jadvallar bor (o'tkazib yuboriladi): ${plan.unknownTables.join(", ")}`,
      "   Sxema o'zgargan bo'lishi mumkin — tiklashdan oldin tekshiring.",
    );
  }
  return lines.join("\n");
}

// ─────────────────────────── Darvozalar (CLI) ────────────────────────────
//
// purge-cli bilan bir xil uslub: tasodifan ishga tushmasin. Tiklash bazaga
// YOZADI, ya'ni mavjud yozuvlar ustiga chiqishi mumkin.

export const RESTORE_ALLOW_ENV = "ONYX_RESTORE_ALLOW";
export const RESTORE_ALLOW_VALUE = "I_UNDERSTAND_WRITE";

export interface RawRestoreArgs {
  file: string | null;
  execute: boolean;
  confirm: boolean;
  envAllow: boolean;
}

export type RestoreArgsResult =
  | { ok: true; file: string; execute: boolean; willWrite: boolean }
  | { ok: false; error: "env" | "file" | "confirm" };

export function parseRestoreArgs(
  argv: string[],
  env: Record<string, string | undefined> = {},
): RawRestoreArgs {
  let file: string | null = null;
  let execute = false;
  let confirm = false;
  for (const a of argv) {
    if (a.startsWith("--file=")) file = a.slice("--file=".length) || null;
    else if (a === "--execute") execute = true;
    else if (a === "--yes") confirm = true;
  }
  return {
    file,
    execute,
    confirm,
    envAllow: env[RESTORE_ALLOW_ENV] === RESTORE_ALLOW_VALUE,
  };
}

export function validateRestoreArgs(raw: RawRestoreArgs): RestoreArgsResult {
  if (!raw.envAllow) return { ok: false, error: "env" };
  if (!raw.file) return { ok: false, error: "file" };
  if (raw.execute && !raw.confirm) return { ok: false, error: "confirm" };
  return {
    ok: true,
    file: raw.file,
    execute: raw.execute,
    willWrite: raw.execute && raw.confirm,
  };
}

export function restoreUsage(): string {
  return [
    "Onyx — zaxiradan tiklash (bazaga YOZADI).",
    "",
    "Quruq yurgizish (hech narsa yozilmaydi):",
    `  ${RESTORE_ALLOW_ENV}=${RESTORE_ALLOW_VALUE} npm run restore -- --file=onyx-backup-2026-08-24.json`,
    "",
    "Haqiqiy tiklash:",
    `  ${RESTORE_ALLOW_ENV}=${RESTORE_ALLOW_VALUE} npm run restore -- --file=... --execute --yes`,
    "",
    "Mavjud id'lar o'tkazib yuboriladi (skipDuplicates) — tiklash takrorlansa",
    "ma'lumot ikkilanmaydi.",
  ].join("\n");
}
