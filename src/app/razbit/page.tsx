// «Разбить камень» (TZ §5.6, §6.4) — server component: загружает плиты
// (AVAILABLE/RESERVED — переходы 3 и 6, data-model.md §2) и партии для
// прямого боя, показывает уведомление о результате.
//
// W10-A: §6.4 narrates one journey (mark broken → photo → AI outline → measure).
// Product keeps AI+photo in Telegram (product decision 2026-07-15); this page
// is the manual/split door. We connect both doors in copy + links — no AI move
// into web, no changes to breaking.ts arithmetic.

import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getCapabilities } from "@/lib/session";
import { formatTashkentDate } from "@/lib/datetime";
import NoAccess from "@/components/NoAccess";
import Alert from "@/components/ui/Alert";
import Card from "@/components/ui/Card";
import BreakForm, { type BatchOption, type SlabOption } from "./BreakForm";

export const metadata: Metadata = {
  title: "Разбить камень — Onyx",
};

// Списки плит/партий должны отражать текущее состояние БД.
export const dynamic = "force-dynamic";

const m2Fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const OK_TEXT: Record<string, string> = {
  break: "Плита переведена в бой / остаток",
  split: "Распил записан: плита разделена на части",
  direct: "Бой записан в партию",
};

export default async function RazbitPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // R2 — rol gate: разбить/бой делает склад (canManageWarehouse: OWNER/WAREHOUSE).
  // TZ §3: MANAGER складом не управляет — теперь тоже видит <NoAccess/>.
  const caps = await getCapabilities();
  if (!caps.canManageWarehouse) {
    return (
      <main className="mx-auto max-w-xl p-4 pb-12">
        <NoAccess />
      </main>
    );
  }

  const sp = await searchParams;

  const [slabRows, batchRows, gridBlocks] = await Promise.all([
    db.slab.findMany({
      where: { status: { in: ["AVAILABLE", "RESERVED"] } },
      orderBy: [{ stoneType: { name: "asc" } }, { label: "asc" }],
      select: {
        id: true,
        label: true,
        status: true,
        block: true,
        landmark: true,
        stoneType: { select: { name: true } },
      },
    }),
    db.batch.findMany({
      orderBy: [{ stoneType: { name: "asc" } }, { arrivedAt: "desc" }],
      select: {
        id: true,
        arrivedAt: true,
        slabsTotal: true,
        areaTotalM2: true,
        stoneType: { select: { name: true } },
      },
    }),
    // ТЗ №7 §2 (BUG-01) — подсказка буквы блока из сетки склада (datalist),
    // как в приёмке. Нормализация всё равно на записи — подсказка лишь удобство.
    db.warehouseBlock.findMany({
      orderBy: { sortOrder: "asc" },
      select: { letter: true, landmarks: { select: { number: true } } },
    }),
  ]);

  const blocks = gridBlocks.map((b) => ({
    letter: b.letter,
    landmarks: b.landmarks.map((l) => l.number),
  }));

  const slabs: SlabOption[] = slabRows.map((s) => ({
    id: s.id,
    label: s.label,
    stoneName: s.stoneType.name,
    reserved: s.status === "RESERVED",
    block: s.block,
    landmark: s.landmark,
  }));

  const batches: BatchOption[] = batchRows.map((b) => ({
    id: b.id,
    stoneName: b.stoneType.name,
    arrived: formatTashkentDate(b.arrivedAt),
    qty: [
      b.slabsTotal !== null && `${b.slabsTotal} плит`,
      b.areaTotalM2 !== null && `${m2Fmt.format(Number(b.areaTotalM2))} м²`,
    ]
      .filter(Boolean)
      .join(" / "),
  }));

  const ok = first(sp.ok) === "1";
  const okText = OK_TEXT[first(sp.action) ?? ""];
  const pieceCount = first(sp.pieces);
  const label = first(sp.label);
  const causeLabel = first(sp.cause);
  const reserveCancelled = first(sp.reserveCancelled) === "1";

  return (
    <main className="mx-auto max-w-xl p-4 pb-12">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
          Onyx · склад
        </p>
        <h1 className="mt-2 font-serif text-display font-bold tracking-tight text-ink">
          Разбить камень
        </h1>
        <p className="mt-2 text-base text-ink/60">
          Бой или распил: система всегда отражает реальное состояние склада.
        </p>
      </header>

      {/* W10-A — two doors for §6.4 (photo+AI stays in Telegram; form below = manual). */}
      <Card className="mb-6 border-gold/30">
        <h2 className="text-base font-bold text-ink">Два пути (сценарий 6.4)</h2>
        <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm text-ink/80">
          <li>
            <span className="font-semibold text-ink">
              Бой с фото и чертежом ИИ
            </span>
            <p className="mt-1">
              1) Откройте Telegram-бот Onyx. 2) Отправьте{" "}
              <strong>фото</strong> битого камня и в подписи (caption) напишите{" "}
              <strong>«бой»</strong> (или «singan»). 3) Бот пришлёт ссылку — на
              странице «Бой по фото» введите размеры сторон по чертежу. ИИ только
              обводит контур; рулеткой измеряете вы.
            </p>
            <p className="mt-2">
              <Link
                href="/singan"
                className="font-semibold text-gold-deep underline"
              >
                Открыть «Бой по фото»
              </Link>
              <span className="text-ink/50">
                {" "}
                — без ссылки из бота форма размеров не откроется; страница
                напомнит шаги.
              </span>
            </p>
          </li>
          <li>
            <span className="font-semibold text-ink">
              Вручную: плита → бой / распил / бой в партию
            </span>
            <p className="mt-1">
              Форма ниже — без ИИ: выбрать плиту или партию, ввести габариты
              кусков. Подходит, когда фото не нужно или бот недоступен.
            </p>
          </li>
        </ol>
      </Card>

      {ok && okText && (
        <Alert variant="success" title={okText} className="mb-6">
          <p>
            {label && `${label} — `}
            {pieceCount && `кусков: ${pieceCount}`}
          </p>
          {causeLabel && (
            <p className="mt-1 text-sm text-ink/70">
              Причина: <span className="font-medium text-ink">{causeLabel}</span>
            </p>
          )}
          {reserveCancelled && (
            <p className="mt-1 font-medium text-warning">
              Бронь на плиту снята — менеджер увидит в журнале.
            </p>
          )}
          <p className="mt-2 text-sm text-ink/70">
            Нужен чертёж по фото? Отправьте фото куска в бот с подписью «бой» —
            откроется{" "}
            <Link href="/singan" className="font-semibold text-gold-deep underline">
              Бой по фото
            </Link>
            .
          </p>
        </Alert>
      )}

      <BreakForm slabs={slabs} batches={batches} blocks={blocks} />
    </main>
  );
}
