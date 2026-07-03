// S2-A — «Брони» (TZ §4.4, §6.6): lazy-sweep просроченных при загрузке,
// список активных броней (камень, клиент, менеджер, срок), снятие брони
// в два шага (details/summary — без confirm()), история, форма новой брони.
// Server component; свободный остаток партий ВЫЧИСЛЯЕТСЯ (ADR-005, §3).
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { computeFreeRemainder } from "@/lib/inventory";
import {
  DEFAULT_RESERVATION_DAYS,
  RESERVATION_DAYS_KEY,
  expireOverdueReservations,
  parseReservationDaysConfig,
} from "@/lib/reservations";
import { cancelReservationAction } from "./actions";
import ReserveForm, {
  type BatchVolumeOption,
  type StoneGroup,
  type UnitOption,
} from "./ReserveForm";

export const metadata: Metadata = {
  title: "Брони — Onyx",
};

// Har doim joriy DB holati (lazy sweep ham shu renderda ishlaydi).
export const dynamic = "force-dynamic";

const m2Fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short" });
const dateTimeFmt = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "short",
});

const PIECE_KIND_RU: Record<string, string> = {
  BROKEN: "бой",
  OFFCUT: "остаток",
};

const HISTORY_STATUS_RU: Record<string, string> = {
  COMPLETED: "продан",
  CANCELLED: "снята",
  EXPIRED: "истекла",
};

type ParamValue = string | string[] | undefined;

function firstParam(v: ParamValue): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

/** Prisma Decimal | null → number | null. */
function toNum(d: { toString(): string } | null): number | null {
  return d === null ? null : Number(d.toString());
}

type ReservationRow = {
  id: string;
  targetType: string;
  qtySlabs: number | null;
  qtyAreaM2: { toString(): string } | null;
  customerName: string;
  customerContact: string | null;
  expiresAt: Date;
  status: string;
  resolvedAt: Date | null;
  manager: { name: string };
  slab: { label: string; stoneType: { name: string } } | null;
  piece: { kind: string; stoneType: { name: string } } | null;
  batch: { arrivedAt: Date; stoneType: { name: string } } | null;
};

/** «Травертин Classic — Плита №2» / «… — бой» / «… — партия от 10.06, 10 плит». */
function stoneLabel(r: ReservationRow): string {
  if (r.slab) return `${r.slab.stoneType.name} — ${r.slab.label}`;
  if (r.piece)
    return `${r.piece.stoneType.name} — ${PIECE_KIND_RU[r.piece.kind] ?? r.piece.kind}`;
  if (r.batch) {
    const qty: string[] = [];
    if (r.qtySlabs !== null) qty.push(`${r.qtySlabs} плит`);
    const area = toNum(r.qtyAreaM2);
    if (area !== null) qty.push(`${m2Fmt.format(area)} м²`);
    return `${r.batch.stoneType.name} — партия от ${dateFmt.format(r.batch.arrivedAt)}, объём: ${qty.join(" + ")}`;
  }
  return "—";
}

export default async function BronPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, ParamValue>>;
}) {
  const params = await searchParams;

  // Lazy sweep (ADR-003): muddati o'tganlar EXPIRED + birlik AVAILABLE.
  await expireOverdueReservations();

  const reservationInclude = {
    manager: { select: { name: true } },
    slab: { select: { label: true, stoneType: { select: { name: true } } } },
    piece: { select: { kind: true, stoneType: { select: { name: true } } } },
    batch: { select: { arrivedAt: true, stoneType: { select: { name: true } } } },
  } as const;

  const [active, history, cfg] = await Promise.all([
    db.reservation.findMany({
      where: { status: "ACTIVE" },
      orderBy: { expiresAt: "asc" },
      include: reservationInclude,
    }),
    db.reservation.findMany({
      where: { status: { in: ["COMPLETED", "CANCELLED", "EXPIRED"] } },
      orderBy: { updatedAt: "desc" },
      take: 20,
      include: reservationInclude,
    }),
    db.appConfig.findUnique({
      where: { key: RESERVATION_DAYS_KEY },
      select: { value: true },
    }),
  ]);
  const defaultDays = cfg
    ? parseReservationDaysConfig(cfg.value)
    : DEFAULT_RESERVATION_DAYS;

  // ── Yangi bron formasi uchun ma'lumot: AVAILABLE birliklar + partiya hajmi ──
  const stoneTypes = await db.stoneType.findMany({
    where: { isArchived: false },
    orderBy: { name: "asc" },
    include: {
      slabs: {
        where: { status: "AVAILABLE", needsCheck: false },
        orderBy: { label: "asc" },
        select: {
          id: true,
          label: true,
          lengthMm: true,
          widthMm: true,
          block: true,
          landmark: true,
        },
      },
      pieces: {
        where: { status: "AVAILABLE", needsCheck: false },
        select: {
          id: true,
          kind: true,
          boundingLengthMm: true,
          boundingWidthMm: true,
          block: true,
          landmark: true,
        },
      },
      batches: {
        where: { needsCheck: false },
        orderBy: { arrivedAt: "asc" },
        include: {
          slabs: { select: { areaM2: true } },
          pieces: { where: { originSlabId: null }, select: { areaM2: true } },
          reservations: {
            where: { status: "ACTIVE", targetType: "BATCH_VOLUME" },
            select: { qtySlabs: true, qtyAreaM2: true },
          },
        },
      },
    },
  });

  const stones: StoneGroup[] = stoneTypes
    .map((st) => {
      const slabs: UnitOption[] = st.slabs.map((s) => ({
        value: `SLAB:${s.id}`,
        label: `${s.label}${
          s.lengthMm !== null && s.widthMm !== null
            ? ` · ${s.lengthMm}×${s.widthMm} мм`
            : ""
        } · Блок ${s.block}, ор. ${s.landmark}`,
      }));
      const pieces: UnitOption[] = st.pieces.map((p) => ({
        value: `PIECE:${p.id}`,
        label: `${PIECE_KIND_RU[p.kind] ?? p.kind} · ${p.boundingLengthMm}×${p.boundingWidthMm} мм · Блок ${p.block}, ор. ${p.landmark}`,
      }));
      const batches: BatchVolumeOption[] = st.batches
        .map((b) => {
          const free = computeFreeRemainder(
            {
              slabsTotal: b.slabsTotal,
              areaTotalM2: toNum(b.areaTotalM2),
              slabsAdjusted: b.slabsAdjusted,
              areaAdjustedM2: Number(b.areaAdjustedM2),
              slabsSoldDirect: b.slabsSoldDirect,
              areaSoldDirectM2: Number(b.areaSoldDirectM2),
            },
            b.slabs.map((s) => ({ areaM2: toNum(s.areaM2) })),
            b.pieces.map((p) => ({ areaM2: toNum(p.areaM2) })),
          );
          const reservedSlabs = b.reservations.reduce(
            (n, r) => n + (r.qtySlabs ?? 0),
            0,
          );
          const reservedAreaM2 = b.reservations.reduce(
            (n, r) => n + (toNum(r.qtyAreaM2) ?? 0),
            0,
          );
          const freeSlabs =
            free.slabsFree === null ? null : free.slabsFree - reservedSlabs;
          const freeAreaM2 =
            free.areaFreeM2 === null ? null : free.areaFreeM2 - reservedAreaM2;
          const freeParts: string[] = [];
          if (freeSlabs !== null) freeParts.push(`~${freeSlabs} плит`);
          if (freeAreaM2 !== null)
            freeParts.push(`≈${m2Fmt.format(freeAreaM2)} м²`);
          return {
            value: `BATCH:${b.id}`,
            label: `Партия от ${dateFmt.format(b.arrivedAt)} · свободно: ${freeParts.join(" · ")}`,
            freeSlabs,
            freeAreaM2,
          };
        })
        // hajm broni uchun hech bo'lmasa bitta o'lchovda joy bo'lsin
        .filter(
          (b) =>
            (b.freeSlabs !== null && b.freeSlabs > 0) ||
            (b.freeAreaM2 !== null && b.freeAreaM2 > 0),
        );
      return {
        id: st.id,
        name: st.name,
        rockType: st.rockType,
        slabs,
        pieces,
        batches,
      };
    })
    .filter((g) => g.slabs.length + g.pieces.length + g.batches.length > 0);

  // «истекает сегодня»: expiresAt bugungi kun oxirigacha (server vaqti).
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const ok = firstParam(params.ok) === "1";
  const cancelled = firstParam(params.cancelled) === "1";
  const err = firstParam(params.err);

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-8">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Брони</h1>
      <p className="mt-1 text-sm text-gray-500">
        Срок брони по умолчанию — {defaultDays} дн.; по истечении камень
        автоматически возвращается «В наличии».
      </p>

      {ok && (
        <p className="mt-4 rounded-xl bg-green-50 p-3 font-medium text-green-800">
          Бронь оформлена.
        </p>
      )}
      {cancelled && (
        <p className="mt-4 rounded-xl bg-green-50 p-3 font-medium text-green-800">
          Бронь снята — камень снова «В наличии».
        </p>
      )}
      {err && (
        <p className="mt-4 rounded-xl bg-red-50 p-3 font-medium text-red-700">
          {err}
        </p>
      )}

      {/* ── Faol bronlar ── */}
      <section className="mt-6">
        <h2 className="text-lg font-bold">Активные брони</h2>
        {active.length === 0 ? (
          <p className="mt-3 text-gray-500">Активных броней нет.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {active.map((r) => {
              const expiresToday = r.expiresAt <= endOfToday;
              return (
                <li key={r.id} className="rounded-xl border border-gray-200 p-4">
                  <div className="font-medium">{stoneLabel(r)}</div>
                  <div className="mt-1 text-sm text-gray-700">
                    Клиент: {r.customerName}
                    {r.customerContact && <> · {r.customerContact}</>}
                  </div>
                  <div className="text-sm text-gray-700">
                    Менеджер: {r.manager.name}
                  </div>
                  <div className="mt-1 text-sm">
                    <span
                      className={
                        expiresToday
                          ? "rounded bg-red-100 px-1.5 py-0.5 font-semibold text-red-700"
                          : "text-gray-700"
                      }
                    >
                      до {dateTimeFmt.format(r.expiresAt)}
                      {expiresToday && " — истекает сегодня"}
                    </span>
                  </div>
                  {/* Ikki bosqichli snятие: details ochiladi → tasdiq tugmasi. */}
                  <details className="mt-2">
                    <summary className="inline-block h-11 cursor-pointer list-none rounded-lg border border-red-200 px-4 leading-[2.75rem] text-base font-medium text-red-600">
                      Снять бронь…
                    </summary>
                    <form
                      action={cancelReservationAction}
                      className="mt-2 flex flex-wrap items-center gap-3 rounded-lg bg-red-50 p-3"
                    >
                      <input type="hidden" name="reservationId" value={r.id} />
                      <span className="text-sm text-red-800">
                        Камень вернётся «В наличии». Точно снять?
                      </span>
                      <button
                        type="submit"
                        className="h-11 rounded-lg bg-red-600 px-4 text-base font-semibold text-white"
                      >
                        Да, снять бронь
                      </button>
                    </form>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Yangi bron ── */}
      <section className="mt-8 rounded-2xl bg-gray-50 p-4">
        <h2 className="mb-3 text-lg font-bold">Новая бронь</h2>
        <ReserveForm stones={stones} defaultDays={defaultDays} />
      </section>

      {/* ── Tarix ── */}
      <section className="mt-8">
        <h2 className="text-lg font-bold">История (последние 20)</h2>
        {history.length === 0 ? (
          <p className="mt-3 text-gray-500">Пока пусто.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {history.map((r) => (
              <li
                key={r.id}
                className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm"
              >
                <span className="font-medium">{stoneLabel(r)}</span> · клиент{" "}
                {r.customerName} · менеджер {r.manager.name} ·{" "}
                <span
                  className={
                    r.status === "COMPLETED"
                      ? "font-semibold text-green-700"
                      : r.status === "EXPIRED"
                        ? "font-semibold text-amber-700"
                        : "font-semibold text-gray-600"
                  }
                >
                  {HISTORY_STATUS_RU[r.status] ?? r.status}
                </span>
                {r.resolvedAt && <> {dateFmt.format(r.resolvedAt)}</>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
