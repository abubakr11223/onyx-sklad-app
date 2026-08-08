// ТЗ №14 §3 — страница правки одной партии.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getCapabilities } from "@/lib/session";
import {
  EMPTY_AGGREGATE,
  EMPTY_HOLD,
  freeRemainderFromAggregate,
  getBatchRemainders,
  getBatchReservationHolds,
} from "@/lib/batch-remainders";
import {
  batchHasMovements,
  freeAfterVolumeHolds,
  minSlabsTotalFloor,
} from "@/lib/batch-edit";
import NoAccess from "@/components/NoAccess";
import BatchEditForm from "../../BatchEditForm";
import { buttonClass } from "@/components/ui/Button";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Правка партии — Onyx",
};

export default async function PriemkaEditBatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const caps = await getCapabilities();
  if (!caps.canManageWarehouse) {
    return (
      <main className="mx-auto max-w-xl p-4 pb-12">
        <NoAccess />
      </main>
    );
  }

  const { id } = await params;
  const batch = await db.batch.findUnique({
    where: { id },
    select: {
      id: true,
      arrivedAt: true,
      supplierNote: true,
      slabsTotal: true,
      areaTotalM2: true,
      slabsAdjusted: true,
      areaAdjustedM2: true,
      slabsSoldDirect: true,
      areaSoldDirectM2: true,
      lengthMm: true,
      widthMm: true,
      thicknessMm: true,
      stoneType: { select: { name: true } },
      patterns: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          description: true,
          thicknessMm: true,
          lengthMm: true,
          widthMm: true,
          slabsCount: true,
          areaM2: true,
          slabsSold: true,
          areaSoldM2: true,
        },
      },
      locations: {
        orderBy: { createdAt: "asc" },
        select: {
          block: true,
          landmark: true,
          slabsHere: true,
          areaHereM2: true,
        },
      },
    },
  });
  if (!batch) notFound();

  const [remMap, holdMap, gridBlocks] = await Promise.all([
    getBatchRemainders(db, [batch.id]),
    getBatchReservationHolds(db, [batch.id]),
    db.warehouseBlock.findMany({
      orderBy: { sortOrder: "asc" },
      select: { letter: true, landmarks: { select: { number: true } } },
    }),
  ]);
  const agg = remMap.get(batch.id) ?? EMPTY_AGGREGATE;
  const hold = holdMap.get(batch.id) ?? EMPTY_HOLD;
  const totals = {
    slabsTotal: batch.slabsTotal,
    areaTotalM2:
      batch.areaTotalM2 === null ? null : Number(batch.areaTotalM2),
    slabsAdjusted: batch.slabsAdjusted,
    areaAdjustedM2: Number(batch.areaAdjustedM2),
    slabsSoldDirect: batch.slabsSoldDirect,
    areaSoldDirectM2: Number(batch.areaSoldDirectM2),
  };
  const free = freeRemainderFromAggregate(totals, agg);
  const freeNet = freeAfterVolumeHolds(free, hold);
  const hasMovements = batchHasMovements(totals, agg, hold);
  const minSlabs = minSlabsTotalFloor(totals, agg, hold);
  // OWNER-only quantity (placeholder access policy).
  const canEditQuantity = caps.canSeeHistory === true;

  const arrivedAtIso = batch.arrivedAt.toISOString().slice(0, 10);
  const blocks = gridBlocks.map((b) => ({
    letter: b.letter,
    landmarks: b.landmarks.map((l) => l.number),
  }));

  return (
    <main className="mx-auto max-w-xl p-4 pb-12">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
          Onyx · склад
        </p>
        <h1 className="mt-2 font-serif text-display font-bold tracking-tight text-ink">
          Правка партии
        </h1>
        <p className="mt-2 text-base text-ink/60">
          <Link href="/priemka" className="text-gold-deep underline">
            ← К приёмке
          </Link>
        </p>
      </header>

      <BatchEditForm
        batchId={batch.id}
        stoneName={batch.stoneType.name}
        canEditQuantity={canEditQuantity}
        hasMovements={hasMovements}
        minSlabsHint={minSlabs}
        freeSlabs={freeNet.slabsFree}
        freeArea={freeNet.areaFreeM2}
        reservedSlabs={hold.reservedSlabs}
        reservedArea={hold.reservedAreaM2}
        slabsTotal={batch.slabsTotal}
        areaTotalM2={
          batch.areaTotalM2 === null ? null : Number(batch.areaTotalM2)
        }
        slabsSoldDirect={batch.slabsSoldDirect}
        areaSoldDirectM2={Number(batch.areaSoldDirectM2)}
        lengthMm={batch.lengthMm}
        widthMm={batch.widthMm}
        thicknessMm={batch.thicknessMm}
        supplierNote={batch.supplierNote}
        arrivedAtIso={arrivedAtIso}
        patterns={batch.patterns.map((p) => ({
          id: p.id,
          description: p.description,
          thicknessMm: p.thicknessMm,
          lengthMm: p.lengthMm,
          widthMm: p.widthMm,
          slabsCount: p.slabsCount,
          areaM2: Number(p.areaM2),
          slabsSold: p.slabsSold,
          areaSoldM2: Number(p.areaSoldM2),
        }))}
        locations={batch.locations.map((l) => ({
          block: l.block,
          landmark: l.landmark,
          slabsHere: l.slabsHere,
          areaHereM2:
            l.areaHereM2 === null || l.areaHereM2 === undefined
              ? null
              : Number(l.areaHereM2),
        }))}
        blocks={blocks}
      />

      <p className="mt-6 text-center text-sm text-ink/50">
        <Link href="/priemka" className={buttonClass("ghost", "sm")}>
          Назад к списку
        </Link>
      </p>
    </main>
  );
}
