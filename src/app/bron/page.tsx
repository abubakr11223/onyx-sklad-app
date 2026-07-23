// S2-A — «Брони» (TZ §4.4, §6.6): lazy-sweep просроченных при загрузке,
// список активных броней (камень, клиент, менеджер, срок), снятие брони
// в два шага (details/summary — без confirm()), история, форма новой брони.
// Server component; свободный остаток партий ВЫЧИСЛЯЕТСЯ (ADR-005, §3).
import type { Metadata } from "next";
import { db } from "@/lib/db";
import {
  EMPTY_AGGREGATE,
  freeRemainderFromAggregate,
  getBatchRemainders,
} from "@/lib/batch-remainders";
import {
  DEFAULT_RESERVATION_DAYS,
  RESERVATION_DAYS_KEY,
  expireOverdueReservations,
  parseReservationDaysConfig,
} from "@/lib/reservations";
import { getCapabilities } from "@/lib/session";
import {
  endOfTashkentDay,
  formatTashkentDate,
  formatTashkentDateTime,
} from "@/lib/datetime";
import NoAccess from "@/components/NoAccess";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";
import CancelReservationButton from "./CancelReservationButton";
import Card from "@/components/ui/Card";
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
    return `${r.batch.stoneType.name} — партия от ${formatTashkentDate(r.batch.arrivedAt)}, объём: ${qty.join(" + ")}`;
  }
  return "—";
}

export default async function BronPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, ParamValue>>;
}) {
  const params = await searchParams;

  // R2 — rol gate: бронь доступна OWNER/MANAGER (canReserve). Складчик — <NoAccess/>.
  const caps = await getCapabilities();
  if (!caps.canReserve) {
    return (
      <main className="mx-auto max-w-3xl p-4 sm:p-8">
        <NoAccess />
      </main>
    );
  }

  // Lazy sweep (ADR-003): muddati o'tganlar EXPIRED + birlik AVAILABLE.
  await expireOverdueReservations();

  const reservationInclude = {
    manager: { select: { name: true } },
    slab: { select: { label: true, stoneType: { select: { name: true } } } },
    piece: { select: { kind: true, stoneType: { select: { name: true } } } },
    batch: { select: { arrivedAt: true, stoneType: { select: { name: true } } } },
  } as const;

  // BATCH-B (perf): данные брони и каталог для формы — одним параллельным
  // Promise.all (мигрируем разрозненный await в общую группу, как в /kamen).
  const [active, history, cfg, stoneTypes] = await Promise.all([
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
    // ── Yangi bron formasi: AVAILABLE birliklar + partiya hajmi ──
    // §3 formula uchun partiyaning BARCHA plita/boy qatorlari EMAS — faqat
    // hisoblagichlar; qoldiq getBatchRemainders (SQL agregat) orqali (pastda).
    db.stoneType.findMany({
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
          select: {
            id: true,
            arrivedAt: true,
            slabsTotal: true,
            areaTotalM2: true,
            slabsAdjusted: true,
            areaAdjustedM2: true,
            slabsSoldDirect: true,
            areaSoldDirectM2: true,
            reservations: {
              where: { status: "ACTIVE", targetType: "BATCH_VOLUME" },
              select: { qtySlabs: true, qtyAreaM2: true },
            },
          },
        },
      },
    }),
  ]);
  const defaultDays = cfg
    ? parseReservationDaysConfig(cfg.value)
    : DEFAULT_RESERVATION_DAYS;

  // §3 formula: partiya qoldiqlari SQL agregatlaridan (butun ombor tortilmaydi).
  const remainders = await getBatchRemainders(
    db,
    stoneTypes.flatMap((st) => st.batches.map((b) => b.id)),
  );

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
          const free = freeRemainderFromAggregate(
            {
              slabsTotal: b.slabsTotal,
              areaTotalM2: toNum(b.areaTotalM2),
              slabsAdjusted: b.slabsAdjusted,
              areaAdjustedM2: Number(b.areaAdjustedM2),
              slabsSoldDirect: b.slabsSoldDirect,
              areaSoldDirectM2: Number(b.areaSoldDirectM2),
            },
            remainders.get(b.id) ?? EMPTY_AGGREGATE,
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
            label: `Партия от ${formatTashkentDate(b.arrivedAt)} · свободно: ${freeParts.join(" · ")}`,
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

  // «истекает сегодня»: expiresAt до конца ТАШКЕНТСКОГО дня (UTC+5), а не
  // UTC-дня сервера — иначе около полуночи бронь помечается неверно (BUG-05).
  const endOfToday = endOfTashkentDay();

  const ok = firstParam(params.ok) === "1";
  const cancelled = firstParam(params.cancelled) === "1";
  const err = firstParam(params.err);

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
          Onyx · менеджер
        </p>
        <h1 className="mt-2 font-serif text-display font-bold tracking-tight text-ink">
          Брони
        </h1>
        <p className="mt-2 text-base text-ink/60">
          Срок брони по умолчанию — {defaultDays} дн.; по истечении камень
          автоматически возвращается «В наличии».
        </p>
      </header>

      {ok && (
        <Alert variant="success" className="mb-4">
          Бронь оформлена.
        </Alert>
      )}
      {cancelled && (
        <Alert variant="success" className="mb-4">
          Бронь снята — камень снова «В наличии».
        </Alert>
      )}
      {err && (
        <Alert variant="danger" className="mb-4">
          {err}
        </Alert>
      )}

      {/* ── Faol bronlar ── */}
      <section className="mt-6">
        <h2 className="text-lg font-semibold text-ink">Активные брони</h2>
        {active.length === 0 ? (
          <p className="mt-3 text-ink/70">Активных броней нет.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {active.map((r) => {
              const expiresToday = r.expiresAt <= endOfToday;
              return (
                <li key={r.id}>
                  <Card>
                    <div className="font-medium text-ink">{stoneLabel(r)}</div>
                    <div className="mt-1 text-sm text-ink/70">
                      Клиент: {r.customerName}
                      {r.customerContact && <> · {r.customerContact}</>}
                    </div>
                    <div className="text-sm text-ink/70">
                      Менеджер: {r.manager.name}
                    </div>
                    <div className="mt-1.5 text-sm">
                      {expiresToday ? (
                        <Badge variant="warning">
                          до {formatTashkentDateTime(r.expiresAt)} — истекает сегодня
                        </Badge>
                      ) : (
                        <span className="text-ink/70">
                          до {formatTashkentDateTime(r.expiresAt)}
                        </span>
                      )}
                    </div>
                    {/* Снятие брони — модал-подтверждение (client + toast). */}
                    <CancelReservationButton
                      reservationId={r.id}
                      label={stoneLabel(r)}
                      action={cancelReservationAction}
                    />
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Yangi bron ── */}
      <section className="mt-8 rounded-card border border-line bg-paper-2 p-4 shadow-card">
        <h2 className="mb-3 text-lg font-semibold text-ink">Новая бронь</h2>
        <ReserveForm stones={stones} defaultDays={defaultDays} />
      </section>

      {/* ── Tarix ── */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-ink">История (последние 20)</h2>
        {history.length === 0 ? (
          <p className="mt-3 text-ink/70">Пока пусто.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {history.map((r) => (
              <li
                key={r.id}
                className="rounded-card border border-line bg-paper-2 p-3 text-sm text-ink/80"
              >
                <span className="font-medium text-ink">{stoneLabel(r)}</span> ·
                клиент {r.customerName} · менеджер {r.manager.name} ·{" "}
                <Badge
                  variant={
                    r.status === "COMPLETED"
                      ? "success"
                      : r.status === "EXPIRED"
                        ? "warning"
                        : "neutral"
                  }
                >
                  {HISTORY_STATUS_RU[r.status] ?? r.status}
                </Badge>
                {r.resolvedAt && <> {formatTashkentDate(r.resolvedAt)}</>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
