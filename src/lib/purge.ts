// W12-A — production inventory purge planner + executor (SAFE tool).
//
// Normative: prisma/schema.prisma onDelete Restrict graph. Operators run
// prisma/purge-cli.ts; this module is unit-testable with a fake client
// (no live DATABASE_URL in tests).
//
// ⛔ IRREVERSIBLE. Dry-run is the default. Execute needs:
//   1) env ONYX_PURGE_ALLOW=I_UNDERSTAND_IRREVERSIBLE
//   2) --scope=A|B|C
//   3) --execute
//   4) --yes
//
// NEVER deletes: User, AppConfig, WarehouseBlock, WarehouseLandmark, KartaCell,
// TelegramAccessRequest, ConsumedMagicLinkToken, TelegramWebhookReceipt.

import type { PrismaClient } from "@prisma/client";

/** Must equal process.env[PURGE_ALLOW_ENV] or the CLI refuses every mode. */
export const PURGE_ALLOW_ENV = "ONYX_PURGE_ALLOW";
export const PURGE_ALLOW_VALUE = "I_UNDERSTAND_IRREVERSIBLE";

export type PurgeScope = "A" | "B" | "C";

export const PURGE_SCOPES: readonly PurgeScope[] = ["A", "B", "C"] as const;

export interface RawPurgeArgs {
  scope: string | null;
  execute: boolean;
  confirm: boolean;
  envAllow: boolean;
}

export type PurgeArgsResult =
  | {
      ok: true;
      scope: PurgeScope;
      execute: boolean;
      /** true only when execute && --yes (and env already checked). */
      willWrite: boolean;
    }
  | {
      ok: false;
      error: "env" | "scope" | "confirm" | "usage";
    };

/**
 * seed-demo.ts markers (verified in source, not guessed):
 * - StoneType.name: "Травертин Classic (демо)", "Оникс Медовый (демо)"
 * - StoneType.qrSlug: "demo-travertin", "demo-onyx"
 * - User phones/names with (демо) are NOT inventory — scopes never delete users.
 */
export function isDemoStoneType(row: {
  name: string;
  qrSlug: string;
}): boolean {
  const name = row.name.toLowerCase();
  if (name.includes("(демо)") || name.includes("(demo)")) return true;
  const slug = row.qrSlug.toLowerCase();
  if (slug.startsWith("demo-")) return true;
  return false;
}

export function parsePurgeArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): RawPurgeArgs {
  let scope: string | null = null;
  let execute = false;
  let confirm = false;

  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg === "--yes") confirm = true;
    else if (arg.startsWith("--scope=")) scope = arg.slice("--scope=".length).trim();
    else if (arg === "--scope" || arg === "-s") {
      // next token handled below if present as separate — only --scope=X supported
    }
  }

  const envAllow = env[PURGE_ALLOW_ENV] === PURGE_ALLOW_VALUE;

  return { scope, execute, confirm, envAllow };
}

export function validatePurgeArgs(raw: RawPurgeArgs): PurgeArgsResult {
  if (!raw.envAllow) return { ok: false, error: "env" };
  if (!raw.scope) return { ok: false, error: "scope" };
  const upper = raw.scope.toUpperCase();
  if (!PURGE_SCOPES.includes(upper as PurgeScope)) {
    return { ok: false, error: "scope" };
  }
  const scope = upper as PurgeScope;
  if (raw.execute && !raw.confirm) return { ok: false, error: "confirm" };
  return {
    ok: true,
    scope,
    execute: raw.execute,
    willWrite: raw.execute && raw.confirm,
  };
}

export function usageText(): string {
  return [
    "Onyx inventory purge (IRREVERSIBLE on --execute).",
    "",
    "Safety gates (all required for a write):",
    `  1) ${PURGE_ALLOW_ENV}=${PURGE_ALLOW_VALUE}`,
    "  2) --scope=A|B|C   (no default scope)",
    "  3) --execute       (without this: dry-run counts only)",
    "  4) --yes           (acknowledge the printed plan)",
    "",
    "Scopes:",
    "  A  demo-marked StoneTypes only (name (демо)/(demo) or qrSlug demo-*)",
    "     + everything hanging off those types. Users never deleted.",
    "  B  ALL StoneTypes + inventory hang-offs (sales/debts/reservations/photos/leads",
    "     on those stones). Keeps AuditLog (orphaned soft refs). Users/grid/config.",
    "  C  full inventory wipe + Debt + SaleRecord + Reservation + Photo + PhotoRequest +",
    "     PhotoDispatch + Lead + AuditLog + MutationReceipt. Keeps accounts,",
    "     AppConfig, warehouse grid, KartaCell, TG access / magic-link / webhook receipts.",
    "",
    "Dry-run (default, no write):",
    `  ${PURGE_ALLOW_ENV}=${PURGE_ALLOW_VALUE} npm run purge:inventory -- --scope=B`,
    "",
    "Execute:",
    `  ${PURGE_ALLOW_ENV}=${PURGE_ALLOW_VALUE} npm run purge:inventory -- --scope=B --execute --yes`,
    "",
    "Cannot be undone. Prefer A, then B. C erases /istoriya content.",
  ].join("\n");
}

// ───────────────────────── Count / plan types ─────────────────────────

export type PurgeTableKey =
  | "photoDispatch"
  | "photo"
  | "debt" // TZ9: before SaleRecord — Debt.saleRecordId ON DELETE RESTRICT
  | "saleRecord"
  | "reservation"
  | "lead"
  | "photoRequest"
  | "piece"
  | "slab"
  | "batchLocation"
  | "batchPattern"
  | "batch"
  | "stoneType"
  | "auditLog"
  | "mutationReceipt"
  | "slabPhotoRequestNull"
  | "photoRequestSlabNull";

/**
 * Deletion order (children first). Restrict FKs require this exact sequence.
 * TZ9: Debt → SaleRecord (schema Debt.saleRecordId onDelete Restrict).
 */
export const PURGE_DELETE_ORDER: readonly PurgeTableKey[] = [
  "photoDispatch",
  "photo",
  "debt",
  "saleRecord",
  "reservation",
  "lead",
  "slabPhotoRequestNull", // break Slab ↔ PhotoRequest cycle
  "photoRequestSlabNull",
  "photoRequest",
  "piece", // before Slab (originSlab Restrict)
  "slab",
  "batchLocation", // after PhotoRequest (PR → BatchLocation Restrict)
  "batchPattern",
  "batch",
  "stoneType",
  "mutationReceipt",
  "auditLog", // scope C only; then we may write one new AuditLog
] as const;

export interface PurgePlanCounts {
  stoneTypes: number;
  batches: number;
  batchLocations: number;
  batchPatterns: number;
  slabs: number;
  pieces: number;
  reservations: number;
  /** TZ9 credit debts on sales being wiped (A/B scoped; C = all). */
  debts: number;
  saleRecords: number;
  photos: number;
  photoRequests: number;
  photoDispatches: number;
  leads: number;
  auditLogs: number;
  mutationReceipts: number;
  /** Slabs whose photoRequestId will be nulled before PR delete. */
  slabsWithPhotoRequest: number;
  /** PhotoRequests whose slabId will be nulled. */
  photoRequestsWithSlab: number;
}

export interface PurgePlan {
  scope: PurgeScope;
  /** Empty for scope C (means "all inventory"). */
  stoneTypeIds: string[];
  batchIds: string[];
  counts: PurgePlanCounts;
  /** Tables never touched by any scope. */
  preserved: string[];
  notes: string[];
}

export const PRESERVED_ALWAYS = [
  "User",
  "AppConfig",
  "WarehouseBlock",
  "WarehouseLandmark",
  "KartaCell",
  "TelegramAccessRequest",
  "ConsumedMagicLinkToken",
  "TelegramWebhookReceipt",
] as const;

type Logger = (msg: string) => void;

/** Minimal DB surface used by plan + execute (tests inject fakes). */
export interface PurgeDb {
  stoneType: {
    findMany(args: {
      where?: unknown;
      select: { id: true; name: true; qrSlug: true };
    }): Promise<Array<{ id: string; name: string; qrSlug: string }>>;
    count(args?: { where?: unknown }): Promise<number>;
    deleteMany(args: { where?: unknown }): Promise<{ count: number }>;
  };
  batch: {
    findMany(args: {
      where?: unknown;
      select: { id: true };
    }): Promise<Array<{ id: string }>>;
    count(args?: { where?: unknown }): Promise<number>;
    deleteMany(args: { where?: unknown }): Promise<{ count: number }>;
  };
  batchLocation: {
    count(args?: { where?: unknown }): Promise<number>;
    deleteMany(args: { where?: unknown }): Promise<{ count: number }>;
  };
  batchPattern: {
    count(args?: { where?: unknown }): Promise<number>;
    deleteMany(args: { where?: unknown }): Promise<{ count: number }>;
  };
  slab: {
    count(args?: { where?: unknown }): Promise<number>;
    updateMany(args: {
      where?: unknown;
      data: { photoRequestId: null };
    }): Promise<{ count: number }>;
    deleteMany(args: { where?: unknown }): Promise<{ count: number }>;
  };
  piece: {
    count(args?: { where?: unknown }): Promise<number>;
    deleteMany(args: { where?: unknown }): Promise<{ count: number }>;
  };
  reservation: {
    count(args?: { where?: unknown }): Promise<number>;
    deleteMany(args: { where?: unknown }): Promise<{ count: number }>;
  };
  saleRecord: {
    count(args?: { where?: unknown }): Promise<number>;
    deleteMany(args: { where?: unknown }): Promise<{ count: number }>;
  };
  debt: {
    count(args?: { where?: unknown }): Promise<number>;
    deleteMany(args: { where?: unknown }): Promise<{ count: number }>;
  };
  photo: {
    count(args?: { where?: unknown }): Promise<number>;
    deleteMany(args: { where?: unknown }): Promise<{ count: number }>;
  };
  photoRequest: {
    count(args?: { where?: unknown }): Promise<number>;
    updateMany(args: {
      where?: unknown;
      data: { slabId: null };
    }): Promise<{ count: number }>;
    deleteMany(args: { where?: unknown }): Promise<{ count: number }>;
  };
  photoDispatch: {
    count(args?: { where?: unknown }): Promise<number>;
    deleteMany(args: { where?: unknown }): Promise<{ count: number }>;
  };
  lead: {
    count(args?: { where?: unknown }): Promise<number>;
    deleteMany(args: { where?: unknown }): Promise<{ count: number }>;
  };
  auditLog: {
    count(args?: { where?: unknown }): Promise<number>;
    deleteMany(args: { where?: unknown }): Promise<{ count: number }>;
    create(args: {
      data: {
        userId: null;
        action: "ADJUSTMENT";
        entityType: string;
        entityId: string;
        payload: unknown;
      };
    }): Promise<unknown>;
  };
  mutationReceipt: {
    count(args?: { where?: unknown }): Promise<number>;
    deleteMany(args: { where?: unknown }): Promise<{ count: number }>;
  };
  $transaction?<T>(
    fn: (tx: PurgeDb) => Promise<T>,
    opts?: { timeout?: number },
  ): Promise<T>;
}

// ───────────────────────── Scope filters ─────────────────────────

async function resolveStoneTypeIds(
  db: PurgeDb,
  scope: PurgeScope,
): Promise<string[]> {
  if (scope === "C" || scope === "B") {
    const all = await db.stoneType.findMany({
      select: { id: true, name: true, qrSlug: true },
    });
    return all.map((s) => s.id);
  }
  // Scope A — demo markers only
  const all = await db.stoneType.findMany({
    select: { id: true, name: true, qrSlug: true },
  });
  return all.filter(isDemoStoneType).map((s) => s.id);
}

// ───────────────────────── Plan ─────────────────────────

export async function planPurge(
  db: PurgeDb,
  scope: PurgeScope,
): Promise<PurgePlan> {
  const stoneTypeIds = await resolveStoneTypeIds(db, scope);
  const batches =
    stoneTypeIds.length === 0
      ? []
      : await db.batch.findMany({
          where: { stoneTypeId: { in: stoneTypeIds } },
          select: { id: true },
        });
  const batchIds = batches.map((b) => b.id);

  const noStones = stoneTypeIds.length === 0;
  const stIn = { in: noStones ? ["__purge_none__"] : stoneTypeIds };
  const batchIn = { in: noStones || batchIds.length === 0 ? ["__purge_none__"] : batchIds };

  // Hang-off filters (Restrict graph)
  const pieceWhere = { stoneTypeId: stIn };
  const slabWhere = { stoneTypeId: stIn };
  const batchWhere = { stoneTypeId: stIn };
  const batchLocWhere = { batchId: batchIn };
  const batchPatWhere = { batchId: batchIn };
  const reservationWhere = {
    OR: [
      { batchId: batchIn },
      { slab: { stoneTypeId: stIn } },
      { piece: { stoneTypeId: stIn } },
    ],
  };
  const saleWhere = {
    OR: [
      { batchId: batchIn },
      { slab: { stoneTypeId: stIn } },
      { piece: { stoneTypeId: stIn } },
      { batchPattern: { batch: { stoneTypeId: stIn } } },
    ],
  };
  // Debt hangs off SaleRecord (Restrict). Same sale scope as saleWhere.
  const debtWhere = { saleRecord: saleWhere };
  const photoWhere = {
    OR: [
      { stoneTypeId: stIn },
      { slab: { stoneTypeId: stIn } },
      { piece: { stoneTypeId: stIn } },
      { photoRequest: { batch: { stoneTypeId: stIn } } },
      { batchPattern: { batch: { stoneTypeId: stIn } } },
    ],
  };
  const prWhere = { batch: { stoneTypeId: stIn } };
  const pdWhere = { photoRequest: { batch: { stoneTypeId: stIn } } };
  const leadWhere =
    scope === "C"
      ? {} // all leads
      : { stoneTypeId: stIn };
  const auditWhere = scope === "C" ? {} : null; // only C deletes audit
  const receiptWhere =
    scope === "C"
      ? {}
      : {
          entityType: "Batch",
          entityId: batchIn,
        };

  // Scope C: unfiltered inventory counts (wipe everything in those tables).
  // Scope A/B: hang-offs under selected stoneTypeIds only.
  const all = scope === "C";

  const [
    stoneTypes,
    batchCount,
    batchLocations,
    batchPatterns,
    slabs,
    pieces,
    reservations,
    debts,
    saleRecords,
    photos,
    photoRequests,
    photoDispatches,
    leads,
    slabsWithPhotoRequest,
    photoRequestsWithSlab,
    auditLogs,
    mutationReceipts,
  ] = await Promise.all([
    all
      ? db.stoneType.count()
      : noStones
        ? Promise.resolve(0)
        : db.stoneType.count({ where: { id: stIn } }),
    all
      ? db.batch.count()
      : noStones
        ? Promise.resolve(0)
        : db.batch.count({ where: batchWhere }),
    all
      ? db.batchLocation.count()
      : noStones || batchIds.length === 0
        ? Promise.resolve(0)
        : db.batchLocation.count({ where: batchLocWhere }),
    all
      ? db.batchPattern.count()
      : noStones || batchIds.length === 0
        ? Promise.resolve(0)
        : db.batchPattern.count({ where: batchPatWhere }),
    all
      ? db.slab.count()
      : noStones
        ? Promise.resolve(0)
        : db.slab.count({ where: slabWhere }),
    all
      ? db.piece.count()
      : noStones
        ? Promise.resolve(0)
        : db.piece.count({ where: pieceWhere }),
    all
      ? db.reservation.count()
      : noStones
        ? Promise.resolve(0)
        : db.reservation.count({ where: reservationWhere }),
    all
      ? db.debt.count()
      : noStones
        ? Promise.resolve(0)
        : db.debt.count({ where: debtWhere }),
    all
      ? db.saleRecord.count()
      : noStones
        ? Promise.resolve(0)
        : db.saleRecord.count({ where: saleWhere }),
    all
      ? db.photo.count()
      : noStones
        ? Promise.resolve(0)
        : db.photo.count({ where: photoWhere }),
    all
      ? db.photoRequest.count()
      : noStones
        ? Promise.resolve(0)
        : db.photoRequest.count({ where: prWhere }),
    all
      ? db.photoDispatch.count()
      : noStones
        ? Promise.resolve(0)
        : db.photoDispatch.count({ where: pdWhere }),
    all
      ? db.lead.count()
      : noStones
        ? Promise.resolve(0)
        : db.lead.count({ where: leadWhere }),
    all
      ? db.slab.count({ where: { photoRequestId: { not: null } } })
      : noStones
        ? Promise.resolve(0)
        : db.slab.count({
            where: { stoneTypeId: stIn, photoRequestId: { not: null } },
          }),
    all
      ? db.photoRequest.count({ where: { slabId: { not: null } } })
      : noStones
        ? Promise.resolve(0)
        : db.photoRequest.count({
            where: { batch: { stoneTypeId: stIn }, slabId: { not: null } },
          }),
    all ? db.auditLog.count() : Promise.resolve(0),
    all
      ? db.mutationReceipt.count()
      : noStones || batchIds.length === 0
        ? Promise.resolve(0)
        : db.mutationReceipt.count({ where: receiptWhere }),
  ]);

  const notes: string[] = [
    "Wipe is IRREVERSIBLE. There is no undo.",
    "Users, AppConfig, WarehouseBlock/Landmark, KartaCell are never deleted.",
  ];
  if (scope === "A") {
    notes.push(
      "Scope A: only StoneTypes matching seed-demo markers (name contains (демо)/(demo) or qrSlug starts with demo-).",
    );
    notes.push(
      "Debts on sales of those stones are deleted BEFORE SaleRecord (Debt→SaleRecord RESTRICT).",
    );
    notes.push(
      "AuditLog rows are kept; /istoriya may show orphan entityIds for deleted demo entities.",
    );
  }
  if (scope === "B") {
    notes.push(
      "Scope B: every StoneType and inventory hang-offs (incl. sales/reservations/photos/leads/debts on those stones).",
    );
    notes.push(
      "Debt deleted before SaleRecord. AuditLog kept (soft refs break). MutationReceipt for deleted Batch ids removed.",
    );
  }
  if (scope === "C") {
    notes.push(
      "Scope C: full inventory + all Debt + SaleRecord + Reservation + Photo* + Lead + AuditLog + MutationReceipt.",
    );
    notes.push(
      "/istoriya will be empty after C (AuditLog wiped). One ADJUSTMENT audit row is written after wipe.",
    );
  }
  if (noStones && scope !== "C") {
    notes.push("No matching StoneTypes — inventory deletes would be no-ops.");
  }

  return {
    scope,
    stoneTypeIds,
    batchIds,
    counts: {
      stoneTypes,
      batches: batchCount,
      batchLocations,
      batchPatterns,
      slabs,
      pieces,
      reservations,
      debts,
      saleRecords,
      photos,
      photoRequests,
      photoDispatches,
      leads,
      auditLogs,
      mutationReceipts,
      slabsWithPhotoRequest,
      photoRequestsWithSlab,
    },
    preserved: [...PRESERVED_ALWAYS],
    notes,
  };
}

export function formatPlanReport(plan: PurgePlan): string {
  const c = plan.counts;
  const lines = [
    `=== PURGE PLAN scope=${plan.scope} (dry-run unless --execute --yes) ===`,
    `StoneType ids matched: ${plan.stoneTypeIds.length}`,
    `Batch ids matched:     ${plan.batchIds.length}`,
    "",
    "Counts that WOULD be deleted / nulled:",
    `  PhotoDispatch:     ${c.photoDispatches}`,
    `  Photo:             ${c.photos}`,
    `  Debt:              ${c.debts}`,
    `  SaleRecord:        ${c.saleRecords}`,
    `  Reservation:       ${c.reservations}`,
    `  Lead:              ${c.leads}`,
    `  Slab.photoRequestId null: ${c.slabsWithPhotoRequest}`,
    `  PhotoRequest.slabId null: ${c.photoRequestsWithSlab}`,
    `  PhotoRequest:      ${c.photoRequests}`,
    `  Piece:             ${c.pieces}`,
    `  Slab:              ${c.slabs}`,
    `  BatchLocation:     ${c.batchLocations}`,
    `  BatchPattern:      ${c.batchPatterns}`,
    `  Batch:             ${c.batches}`,
    `  StoneType:         ${c.stoneTypes}`,
    `  MutationReceipt:   ${c.mutationReceipts}`,
    `  AuditLog:          ${c.auditLogs}`,
    "",
    "Preserved (never deleted):",
    ...plan.preserved.map((p) => `  - ${p}`),
    "",
    "Notes:",
    ...plan.notes.map((n) => `  • ${n}`),
  ];
  return lines.join("\n");
}

// ───────────────────────── Execute ─────────────────────────

export interface PurgeExecuteResult {
  scope: PurgeScope;
  deleted: PurgePlanCounts;
  auditLogged: boolean;
  ms: number;
}

/**
 * Delete in Restrict-safe order inside one transaction when $transaction exists.
 * Caller must have already validated env + --execute + --yes.
 */
export async function executePurge(
  db: PurgeDb,
  scope: PurgeScope,
  log: Logger = () => {},
): Promise<PurgeExecuteResult> {
  const started = Date.now();
  const plan = await planPurge(db, scope);
  log(formatPlanReport(plan));
  log("");
  log("EXECUTING wipe (irreversible)…");

  const run = async (tx: PurgeDb): Promise<PurgePlanCounts> => {
    const stoneTypeIds = plan.stoneTypeIds;
    const noStones = stoneTypeIds.length === 0;
    const all = scope === "C"; // wipe every inventory row, not only matched stones
    const stIn = { in: noStones ? ["__purge_none__"] : stoneTypeIds };
    const batchIds = plan.batchIds;
    const batchIn = {
      in:
        noStones || batchIds.length === 0 ? ["__purge_none__"] : batchIds,
    };

    const zero: PurgePlanCounts = {
      stoneTypes: 0,
      batches: 0,
      batchLocations: 0,
      batchPatterns: 0,
      slabs: 0,
      pieces: 0,
      reservations: 0,
      debts: 0,
      saleRecords: 0,
      photos: 0,
      photoRequests: 0,
      photoDispatches: 0,
      leads: 0,
      auditLogs: 0,
      mutationReceipts: 0,
      slabsWithPhotoRequest: 0,
      photoRequestsWithSlab: 0,
    };

    // Scope A/B with no matching stones: nothing inventory-related to delete.
    if (!all && noStones) {
      return zero;
    }

    const pieceWhere = all ? {} : { stoneTypeId: stIn };
    const slabWhere = all ? {} : { stoneTypeId: stIn };
    const batchWhere = all ? {} : { stoneTypeId: stIn };
    const batchLocWhere = all ? {} : { batchId: batchIn };
    const batchPatWhere = all ? {} : { batchId: batchIn };
    const reservationWhere = all
      ? {}
      : {
          OR: [
            { batchId: batchIn },
            { slab: { stoneTypeId: stIn } },
            { piece: { stoneTypeId: stIn } },
          ],
        };
    const saleWhere = all
      ? {}
      : {
          OR: [
            { batchId: batchIn },
            { slab: { stoneTypeId: stIn } },
            { piece: { stoneTypeId: stIn } },
            { batchPattern: { batch: { stoneTypeId: stIn } } },
          ],
        };
    const debtWhere = all ? {} : { saleRecord: saleWhere };
    const photoWhere = all
      ? {}
      : {
          OR: [
            { stoneTypeId: stIn },
            { slab: { stoneTypeId: stIn } },
            { piece: { stoneTypeId: stIn } },
            { photoRequest: { batch: { stoneTypeId: stIn } } },
            { batchPattern: { batch: { stoneTypeId: stIn } } },
          ],
        };
    const prWhere = all ? {} : { batch: { stoneTypeId: stIn } };
    const pdWhere = all
      ? {}
      : { photoRequest: { batch: { stoneTypeId: stIn } } };

    // 1 PhotoDispatch
    const photoDispatches = (
      await tx.photoDispatch.deleteMany({ where: pdWhere })
    ).count;
    log(`  PhotoDispatch deleted: ${photoDispatches}`);

    // 2 Photo
    const photos = (await tx.photo.deleteMany({ where: photoWhere })).count;
    log(`  Photo deleted: ${photos}`);

    // 3 Debt BEFORE SaleRecord (Debt.saleRecordId ON DELETE RESTRICT — TZ9)
    const debts = (await tx.debt.deleteMany({ where: debtWhere })).count;
    log(`  Debt deleted: ${debts}`);

    // 4 SaleRecord
    const saleRecords = (await tx.saleRecord.deleteMany({ where: saleWhere }))
      .count;
    log(`  SaleRecord deleted: ${saleRecords}`);

    // 5 Reservation
    const reservations = (
      await tx.reservation.deleteMany({ where: reservationWhere })
    ).count;
    log(`  Reservation deleted: ${reservations}`);

    // 5 Lead
    const leads = (
      await tx.lead.deleteMany({
        where: all ? {} : { stoneTypeId: stIn },
      })
    ).count;
    log(`  Lead deleted: ${leads}`);

    // 6–7 break Slab ↔ PhotoRequest cycle (optional FKs default Restrict)
    const slabsWithPhotoRequest = (
      await tx.slab.updateMany({
        where: all
          ? { photoRequestId: { not: null } }
          : { stoneTypeId: stIn, photoRequestId: { not: null } },
        data: { photoRequestId: null },
      })
    ).count;
    const photoRequestsWithSlab = (
      await tx.photoRequest.updateMany({
        where: all
          ? { slabId: { not: null } }
          : { batch: { stoneTypeId: stIn }, slabId: { not: null } },
        data: { slabId: null },
      })
    ).count;
    log(`  Slab.photoRequestId nulled: ${slabsWithPhotoRequest}`);
    log(`  PhotoRequest.slabId nulled: ${photoRequestsWithSlab}`);

    // 8 PhotoRequest
    const photoRequests = (
      await tx.photoRequest.deleteMany({ where: prWhere })
    ).count;
    log(`  PhotoRequest deleted: ${photoRequests}`);

    // 9 Piece before Slab (originSlab Restrict)
    const pieces = (await tx.piece.deleteMany({ where: pieceWhere })).count;
    log(`  Piece deleted: ${pieces}`);

    // 10 Slab
    const slabs = (await tx.slab.deleteMany({ where: slabWhere })).count;
    log(`  Slab deleted: ${slabs}`);

    // 11 BatchLocation
    const batchLocations = (
      await tx.batchLocation.deleteMany({ where: batchLocWhere })
    ).count;
    log(`  BatchLocation deleted: ${batchLocations}`);

    // 12 BatchPattern
    const batchPatterns = (
      await tx.batchPattern.deleteMany({ where: batchPatWhere })
    ).count;
    log(`  BatchPattern deleted: ${batchPatterns}`);

    // 13 Batch
    const batches = (await tx.batch.deleteMany({ where: batchWhere })).count;
    log(`  Batch deleted: ${batches}`);

    // 14 StoneType
    const stoneTypes = (
      await tx.stoneType.deleteMany({
        where: all ? {} : { id: stIn },
      })
    ).count;
    log(`  StoneType deleted: ${stoneTypes}`);

    // 15 MutationReceipt
    const mutationReceipts = (
      await tx.mutationReceipt.deleteMany({
        where: all
          ? {}
          : { entityType: "Batch", entityId: batchIn },
      })
    ).count;
    log(`  MutationReceipt deleted: ${mutationReceipts}`);

    // 16 AuditLog — scope C only
    let auditLogs = 0;
    if (all) {
      auditLogs = (await tx.auditLog.deleteMany({})).count;
      log(`  AuditLog deleted: ${auditLogs}`);
    }

    return {
      stoneTypes,
      batches,
      batchLocations,
      batchPatterns,
      slabs,
      pieces,
      reservations,
      debts,
      saleRecords,
      photos,
      photoRequests,
      photoDispatches,
      leads,
      auditLogs,
      mutationReceipts,
      slabsWithPhotoRequest,
      photoRequestsWithSlab,
    };
  };

  let deleted: PurgePlanCounts;
  if (typeof db.$transaction === "function") {
    deleted = await db.$transaction((tx) => run(tx), { timeout: 300_000 });
  } else {
    deleted = await run(db);
  }

  // Post-tx audit marker (A/B/C). For C this is the only remaining AuditLog.
  // Not inside the wipe order before AuditLog delete in C — written after.
  let auditLogged = false;
  try {
    await db.auditLog.create({
      data: {
        userId: null,
        action: "ADJUSTMENT",
        entityType: "Purge",
        entityId: `scope-${scope}`,
        payload: {
          kind: "inventory_purge",
          scope,
          deleted,
          irreversible: true,
        },
      },
    });
    auditLogged = true;
    log("  AuditLog: wrote ADJUSTMENT inventory_purge marker");
  } catch (e) {
    log(
      `  AuditLog marker FAILED (wipe already committed): ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  return {
    scope,
    deleted,
    auditLogged,
    ms: Date.now() - started,
  };
}

/** Convenience for real PrismaClient without casting at call sites. */
export async function planPurgeClient(
  db: PrismaClient,
  scope: PurgeScope,
): Promise<PurgePlan> {
  return planPurge(db as unknown as PurgeDb, scope);
}

export async function executePurgeClient(
  db: PrismaClient,
  scope: PurgeScope,
  log?: Logger,
): Promise<PurgeExecuteResult> {
  return executePurge(db as unknown as PurgeDb, scope, log);
}
