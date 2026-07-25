// «Карта склада» (TZ §4.5, ТЗ №6) — где какой камень физически лежит + РЕДАКТОР
// сетки склада (блоки/ориентиры), независимой от камня. Стратегия внедрения
// (§10): сначала разметить склад, потом заносить камень. Пустой блок — норма.
//
// Просмотр: OWNER/MANAGER/WAREHOUSE (canSeeExactRemainder). Редактирование сетки
// (?edit=1): ТОЛЬКО Владелец (getRealSessionUser). Данные сетки — WarehouseBlock/
// WarehouseLandmark; камень — BatchLocation (по букве/номеру). На карте — объединение.

import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getCapabilities, getRealSessionUser } from "@/lib/session";
import NoAccess from "@/components/NoAccess";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import { inputClass } from "@/components/ui/Field";
import { FlagIcon } from "@/components/ui/Icons";
import {
  addBlock,
  renameBlock,
  deleteBlock,
  setBlockMeta,
  addLandmark,
  removeLandmark,
} from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Карта склада — Onyx" };

const m2Fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const collator = new Intl.Collator("ru-RU", { numeric: true, sensitivity: "base" });

type StoneHere = {
  stoneTypeId: string;
  name: string;
  slabsHere: number | null;
  areaHereM2: number | null;
};

const ERR_RU: Record<string, string> = {
  denied: "Редактировать карту может только владелец.",
  letter: "Укажите букву блока.",
  area: "Некорректная площадь.",
  number: "Укажите номер ориентира.",
  block_taken: "Блок с такой буквой уже есть.",
  landmark_taken: "Ориентир с таким номером уже есть в блоке.",
  block_has_stone: "Нельзя удалить: в блоке есть камень. Сначала переместите/спишите его.",
  notfound: "Не найдено.",
};
const OK_RU: Record<string, string> = {
  block: "Блок добавлен.",
  renamed: "Блок переименован.",
  deleted: "Блок удалён.",
  meta: "Сохранено.",
  landmark: "Ориентир добавлен.",
  landmark_removed: "Ориентир убран.",
};

export default async function KartaSkladaPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; ok?: string; err?: string }>;
}) {
  const caps = await getCapabilities();
  if (!caps.canSeeExactRemainder) {
    return (
      <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
        <NoAccess />
      </main>
    );
  }

  const sp = await searchParams;
  const [gridBlocks, locations, me] = await Promise.all([
    db.warehouseBlock.findMany({
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        letter: true,
        areaM2: true,
        note: true,
        isFull: true,
        sortOrder: true,
        landmarks: { select: { id: true, number: true } },
      },
    }),
    db.batchLocation.findMany({
      select: {
        block: true,
        landmark: true,
        slabsHere: true,
        areaHereM2: true,
        batch: {
          select: { stoneTypeId: true, stoneType: { select: { name: true } } },
        },
      },
    }),
    getRealSessionUser(),
  ]);

  const isOwner = me?.role === "OWNER";
  const editMode = isOwner && sp.edit === "1";
  const okMsg = sp.ok ? OK_RU[sp.ok] : undefined;
  const errMsg = sp.err ? (ERR_RU[sp.err] ?? "Не удалось выполнить.") : undefined;

  // ── Объединяем сетку (WarehouseBlock) и камень (BatchLocation) по букве блока ──
  type BEntry = {
    blockId: string | null;
    areaM2: number | null;
    note: string | null;
    isFull: boolean;
    sortOrder: number;
    landmarks: Map<string, { landmarkId: string | null; stones: StoneHere[] }>;
  };
  const map = new Map<string, BEntry>();

  for (const gb of gridBlocks) {
    const lm = new Map<string, { landmarkId: string | null; stones: StoneHere[] }>();
    for (const l of gb.landmarks) lm.set(l.number, { landmarkId: l.id, stones: [] });
    map.set(gb.letter, {
      blockId: gb.id,
      areaM2: gb.areaM2 === null ? null : Number(gb.areaM2),
      note: gb.note,
      isFull: gb.isFull,
      sortOrder: gb.sortOrder,
      landmarks: lm,
    });
  }
  for (const loc of locations) {
    let b = map.get(loc.block);
    if (!b) {
      b = { blockId: null, areaM2: null, note: null, isFull: false, sortOrder: 1e9, landmarks: new Map() };
      map.set(loc.block, b);
    }
    let l = b.landmarks.get(loc.landmark);
    if (!l) {
      l = { landmarkId: null, stones: [] };
      b.landmarks.set(loc.landmark, l);
    }
    l.stones.push({
      stoneTypeId: loc.batch.stoneTypeId,
      name: loc.batch.stoneType.name,
      slabsHere: loc.slabsHere,
      areaHereM2: loc.areaHereM2 === null ? null : Number(loc.areaHereM2),
    });
  }

  const blocks = [...map.entries()]
    .sort((a, b) => a[1].sortOrder - b[1].sortOrder || collator.compare(a[0], b[0]))
    .map(([letter, b]) => ({
      letter,
      blockId: b.blockId,
      areaM2: b.areaM2,
      note: b.note,
      isFull: b.isFull,
      landmarks: [...b.landmarks.entries()]
        .sort((x, y) => collator.compare(x[0], y[0]))
        .map(([number, l]) => ({ number, landmarkId: l.landmarkId, stones: l.stones })),
    }));

  return (
    <main className="mx-auto max-w-5xl p-4 pb-12 sm:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
            Onyx · склад
          </p>
          <h1 className="mt-2 font-serif text-display font-bold tracking-tight text-ink">
            Карта склада
          </h1>
          <p className="mt-1 text-sm text-ink/60">
            Блоки — зоны, ориентиры — флажки. Размечайте склад заранее, включая
            пустые зоны.
          </p>
        </div>
        {/* ТЗ №6 — переключатель режима редактирования (только владелец). */}
        {isOwner &&
          (editMode ? (
            <Link href="/karta-sklada">
              <Button variant="primary" size="sm">
                Готово
              </Button>
            </Link>
          ) : (
            <Link href="/karta-sklada?edit=1">
              <Button variant="secondary" size="sm">
                Редактировать карту
              </Button>
            </Link>
          ))}
      </header>

      {okMsg && (
        <Alert variant="success" className="mb-4">
          {okMsg}
        </Alert>
      )}
      {errMsg && (
        <Alert variant="danger" className="mb-4">
          {errMsg}
        </Alert>
      )}

      {/* Режим редактирования: добавить новый блок. */}
      {editMode && (
        <Card className="mb-6 border-gold/40">
          <h2 className="mb-3 font-serif text-xl font-bold text-ink">Добавить блок</h2>
          <form action={addBlock} className="flex flex-wrap items-end gap-2">
            <input
              name="letter"
              placeholder="Буква (А, Б…)"
              required
              aria-label="Буква блока"
              className={`${inputClass} sm:max-w-[8rem]`}
            />
            <input
              name="areaM2"
              inputMode="decimal"
              placeholder="Площадь м² (необяз.)"
              aria-label="Площадь блока"
              className={`${inputClass} sm:max-w-[12rem]`}
            />
            <Button type="submit" size="sm">
              Добавить блок
            </Button>
          </form>
        </Card>
      )}

      {blocks.length === 0 ? (
        <Card>
          <p className="text-sm text-ink/70">
            {editMode
              ? "Блоков ещё нет. Добавьте первый блок выше."
              : "Склад ещё не размечен. Владелец может добавить блоки: «Редактировать карту»."}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {blocks.map((blk) => {
            // ТЗ №7 §4 — идентификатор блока для форм правки: сетевой блок шлёт
            // blockId, авто-блок (из приёмки) — свою букву (fromLetter), сервер
            // материализует его при первой правке. Так все блоки редактируются.
            const idField = blk.blockId ? (
              <input type="hidden" name="blockId" value={blk.blockId} />
            ) : (
              <input type="hidden" name="fromLetter" value={blk.letter} />
            );
            return (
            <section
              key={blk.letter}
              className="relative overflow-hidden rounded-card border border-line bg-paper-2 p-5 shadow-card"
            >
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-2">
                  <span className="font-serif text-3xl font-bold leading-none text-gold-deep">
                    {blk.letter}
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/50">
                    блок
                  </span>
                </div>
                <Badge variant={blk.isFull ? "warning" : "success"}>
                  {blk.isFull ? "заполнен" : "есть место"}
                </Badge>
              </div>

              {/* Площадь + заметка (просмотр). */}
              {(blk.areaM2 !== null || blk.note) && (
                <p className="mb-3 text-xs text-ink/60">
                  {blk.areaM2 !== null && <>≈{m2Fmt.format(blk.areaM2)} м²</>}
                  {blk.areaM2 !== null && blk.note && " · "}
                  {blk.note}
                </p>
              )}

              {/* ── Режим редактирования: правки блока (все блоки, ТЗ №7 §4) ── */}
              {editMode && (
                <div className="mb-3 flex flex-col gap-2 rounded-field border border-gold/25 bg-gold/[0.04] p-3">
                  {!blk.blockId && (
                    <p className="text-xs text-ink/50">
                      Блок из приёмки. Любая правка внесёт его в сетку склада.
                    </p>
                  )}
                  <form action={renameBlock} className="flex flex-wrap items-end gap-1.5">
                    {idField}
                    <input
                      name="letter"
                      defaultValue={blk.letter}
                      aria-label="Буква"
                      className={`${inputClass} max-w-[6rem]`}
                    />
                    <Button type="submit" variant="secondary" size="sm">
                      Переименовать
                    </Button>
                  </form>
                  <form action={setBlockMeta} className="flex flex-col gap-1.5">
                    {idField}
                    <input
                      name="areaM2"
                      inputMode="decimal"
                      defaultValue={blk.areaM2 ?? ""}
                      placeholder="Площадь м²"
                      aria-label="Площадь"
                      className={inputClass}
                    />
                    <input
                      name="note"
                      defaultValue={blk.note ?? ""}
                      placeholder="Заметка (у ворот, плохой заезд…)"
                      aria-label="Заметка"
                      className={inputClass}
                    />
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        name="isFull"
                        value="1"
                        defaultChecked={blk.isFull}
                        className="h-5 w-5 accent-ink"
                      />
                      Заполнен (нет места)
                    </label>
                    <Button type="submit" variant="secondary" size="sm">
                      Сохранить
                    </Button>
                  </form>
                  <form action={deleteBlock}>
                    {idField}
                    <Button type="submit" variant="danger" size="sm">
                      Удалить блок
                    </Button>
                  </form>
                </div>
              )}

              {/* Ориентиры. */}
              <div className="space-y-3">
                {blk.landmarks.length === 0 && (
                  <p className="text-xs text-ink/40">Ориентиров пока нет.</p>
                )}
                {blk.landmarks.map((lm) => (
                  <div
                    key={lm.number}
                    className="rounded-field border border-ink/8 bg-paper/50 p-3"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="inline-flex items-center gap-1.5 rounded-field bg-gold/15 px-2.5 py-1 text-sm font-bold text-gold-deep ring-1 ring-gold/25">
                        <FlagIcon className="h-4 w-4" />
                        <span>{lm.number}</span>
                      </div>
                      {editMode && lm.landmarkId && (
                        <form action={removeLandmark}>
                          <input type="hidden" name="landmarkId" value={lm.landmarkId} />
                          <Button type="submit" variant="ghost" size="sm" className="text-danger">
                            Убрать
                          </Button>
                        </form>
                      )}
                    </div>
                    {lm.stones.length > 0 ? (
                      <ul className="space-y-0.5">
                        {lm.stones.map((s, i) => {
                          const qty: string[] = [];
                          if (s.slabsHere !== null) qty.push(`~${s.slabsHere} плит`);
                          if (s.areaHereM2 !== null)
                            qty.push(`≈${m2Fmt.format(s.areaHereM2)} м²`);
                          return (
                            <li key={s.stoneTypeId + "|" + i}>
                              <Link
                                href={"/kamen/" + s.stoneTypeId}
                                className="flex min-h-11 flex-wrap items-center gap-x-2 text-ink hover:text-gold-deep hover:underline"
                              >
                                <span className="font-medium">{s.name}</span>
                                {qty.length > 0 && (
                                  <Badge variant="neutral">{qty.join(" · ")}</Badge>
                                )}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="text-xs text-ink/40">Пусто.</p>
                    )}
                  </div>
                ))}

                {/* Добавить ориентир в блок — все блоки (ТЗ №7 §4). */}
                {editMode && (
                  <form
                    action={addLandmark}
                    className="flex flex-wrap items-end gap-1.5 pt-1"
                  >
                    {idField}
                    <input
                      name="number"
                      placeholder="Номер (1, 2…)"
                      required
                      aria-label="Номер ориентира"
                      className={`${inputClass} max-w-[8rem]`}
                    />
                    <Button type="submit" variant="secondary" size="sm">
                      + Ориентир
                    </Button>
                  </form>
                )}
              </div>
            </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
