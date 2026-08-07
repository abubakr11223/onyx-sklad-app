// W7-A2 — idempotent intake (MutationReceipt).
// Prevents double Batch on double-submit / flaky retry / online auto-resubmit.
// Pattern: ConsumedMagicLinkToken (unique id + P2002) — here P2002 = replay of
// a successful intake, not auth deny.
//
// Pure helpers + transactional create are unit-tested with a fake tx (no DB).

import { Prisma, type PrismaClient } from "@prisma/client";
import type { ValidIntake } from "@/lib/validators/intake";

/** Interactive transaction client (omit connection helpers). */
export type IntakeReceiptTx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;

export const INTAKE_MUTATION_KIND = "INTAKE";
export const INTAKE_ENTITY_TYPE = "Batch";

/** UUID v4 (case-insensitive). Rejects empty / garbage so server never treats junk as a key. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseMutationId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!UUID_RE.test(t)) return null;
  return t.toLowerCase();
}

export interface IntakeReceiptResultJson {
  stoneName: string;
  patternIds: string[];
}

export interface IntakeCreateSummary {
  stoneName: string;
  batchId: string;
  patternIds: string[];
  /** true → domain write was skipped; returned existing batch from receipt. */
  replay: boolean;
}

/**
 * Thrown inside $transaction when this tx created a Batch but lost the race
 * on MutationReceipt INSERT (P2002). The transaction MUST roll back so the
 * orphan Batch is discarded; caller then uses `winner` for redirect.
 */
export class IntakeConcurrentClaimError extends Error {
  constructor(public readonly winner: IntakeCreateSummary) {
    super("INTAKE_CONCURRENT_CLAIM");
    this.name = "IntakeConcurrentClaimError";
  }
}

export interface CreateIntakeWithReceiptArgs {
  mutationId: string;
  actorId: string | null;
  data: ValidIntake;
  /** When true, new stone type may store basePrice. */
  canSeePrices: boolean;
  slugify: (name: string) => string;
  randomSuffix: () => string;
}

function summaryFromReceipt(
  entityId: string,
  resultJson: unknown,
): IntakeCreateSummary {
  const j = (resultJson ?? {}) as Partial<IntakeReceiptResultJson>;
  return {
    batchId: entityId,
    stoneName: typeof j.stoneName === "string" ? j.stoneName : "камень",
    patternIds: Array.isArray(j.patternIds)
      ? j.patternIds.filter((x): x is string => typeof x === "string")
      : [],
    replay: true,
  };
}

/**
 * Single-transaction intake: check receipt → create domain → write receipt.
 * Concurrent second writer: receipt create P2002 → load winner → throw
 * IntakeConcurrentClaimError (rolls back this tx's Batch).
 */
export async function createIntakeWithReceipt(
  tx: IntakeReceiptTx,
  args: CreateIntakeWithReceiptArgs,
): Promise<IntakeCreateSummary> {
  const { mutationId, actorId, data, canSeePrices, slugify, randomSuffix } =
    args;

  const existing = await tx.mutationReceipt.findUnique({
    where: { mutationId },
    select: { entityId: true, resultJson: true },
  });
  if (existing) {
    return summaryFromReceipt(existing.entityId, existing.resultJson);
  }

  let stoneTypeId: string;
  let stoneName: string;
  const patternIds: string[] = [];

  if (data.stoneType.kind === "existing") {
    const st = await tx.stoneType.findUnique({
      where: { id: data.stoneType.id },
      select: { id: true, name: true, isArchived: true },
    });
    if (!st || st.isArchived) {
      throw new IntakeFieldError(
        "stoneTypeId",
        "Вид камня не найден — обновите страницу и выберите заново",
      );
    }
    stoneTypeId = st.id;
    stoneName = st.name;
  } else {
    const stNew = data.stoneType;
    const duplicate = await tx.stoneType.findUnique({
      where: { name: stNew.name },
      select: { id: true },
    });
    if (duplicate) {
      throw new IntakeFieldError(
        "newName",
        "Вид с таким названием уже есть — выберите его из списка",
      );
    }
    const basePrice =
      canSeePrices && stNew.basePrice !== null
        ? stNew.basePrice.toFixed(2)
        : null;
    const created = await tx.stoneType.create({
      data: {
        name: stNew.name,
        rockType: stNew.rockType,
        color: stNew.color,
        description: stNew.description,
        basePrice,
        qrSlug: `${slugify(stNew.name)}-${randomSuffix()}`,
      },
      select: { id: true, name: true },
    });
    stoneTypeId = created.id;
    stoneName = created.name;
  }

  const batch = await tx.batch.create({
    data: {
      stoneTypeId,
      arrivedAt: data.arrivedAt,
      supplierNote: data.supplierNote,
      slabsTotal: data.slabsTotal,
      areaTotalM2: data.areaTotalM2 === null ? null : String(data.areaTotalM2),
      lengthMm: data.lengthMm,
      widthMm: data.widthMm,
      thicknessMm: data.thicknessMm,
      locations: {
        create: data.locations.map((loc) => ({
          block: loc.block,
          landmark: loc.landmark,
          slabsHere: loc.slabsHere,
          areaHereM2: loc.areaHereM2 === null ? null : String(loc.areaHereM2),
        })),
      },
    },
    select: { id: true },
  });

  for (const p of data.patterns) {
    const pat = await tx.batchPattern.create({
      data: {
        batchId: batch.id,
        description: p.description,
        thicknessMm: p.thicknessMm,
        lengthMm: p.lengthMm,
        widthMm: p.widthMm,
        slabsCount: p.slabs,
        areaM2: String(p.areaM2),
      },
      select: { id: true },
    });
    patternIds.push(pat.id);
  }

  await tx.auditLog.create({
    data: {
      userId: actorId,
      action: "INTAKE",
      entityType: "Batch",
      entityId: batch.id,
      payload: {
        mutationId,
        stoneTypeId,
        stoneName,
        newStoneType: data.stoneType.kind === "new",
        slabsTotal: data.slabsTotal,
        areaTotalM2: data.areaTotalM2,
        supplierNote: data.supplierNote,
        arrivedAt: data.arrivedAt.toISOString(),
        locations: data.locations.map((loc) => ({
          block: loc.block,
          landmark: loc.landmark,
          slabsHere: loc.slabsHere,
          areaHereM2: loc.areaHereM2,
        })),
        lengthMm: data.lengthMm,
        widthMm: data.widthMm,
        thicknessMm: data.thicknessMm,
        patterns: data.patterns.map((p) => ({
          description: p.description,
          thicknessMm: p.thicknessMm,
          lengthMm: p.lengthMm,
          widthMm: p.widthMm,
          slabs: p.slabs,
          areaM2: p.areaM2,
        })),
      },
    },
  });

  // Prisma InputJsonValue — plain object without index signature.
  const resultJson = {
    stoneName,
    patternIds,
  } as Prisma.InputJsonValue;

  try {
    await tx.mutationReceipt.create({
      data: {
        mutationId,
        kind: INTAKE_MUTATION_KIND,
        userId: actorId,
        entityType: INTAKE_ENTITY_TYPE,
        entityId: batch.id,
        resultJson,
      },
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const winner = await tx.mutationReceipt.findUnique({
        where: { mutationId },
        select: { entityId: true, resultJson: true },
      });
      if (winner) {
        // Roll back this tx's Batch (orphan) — outer $transaction aborts.
        throw new IntakeConcurrentClaimError(
          summaryFromReceipt(winner.entityId, winner.resultJson),
        );
      }
    }
    throw e;
  }

  return {
    stoneName,
    batchId: batch.id,
    patternIds,
    replay: false,
  };
}

/** Field-level error — same contract as priemka/actions IntakeFieldError. */
export class IntakeFieldError extends Error {
  constructor(
    public field: string,
    message: string,
  ) {
    super(message);
    this.name = "IntakeFieldError";
  }
}

/** Detect P2002 whether from real Prisma or a test double. */
export function isUniqueViolation(e: unknown): boolean {
  return (
    (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") ||
    (typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code: string }).code === "P2002")
  );
}
