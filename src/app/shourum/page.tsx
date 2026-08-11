// TZ №15 Slice 3 — «Шоу-рум»: list + send + return / sell / sample.
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getCapabilities, currentActorId } from "@/lib/session";
import { formatTashkentDateTime } from "@/lib/datetime";
import { listShowroom, MAX_SHOWROOM_PAGE } from "@/lib/showroom";
import { computeFreeRemainder } from "@/lib/inventory";
import { formatGabarit } from "@/lib/dimensions";
import NoAccess from "@/components/NoAccess";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import Field, { inputClass } from "@/components/ui/Field";
import {
  sendToShowroomAction,
  returnFromShowroomAction,
  sellFromShowroomAction,
  sampleFromShowroomAction,
} from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Шоу-рум — Onyx" };

type SP = Record<string, string | string[] | undefined>;
function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

export default async function ShourumPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const caps = await getCapabilities();
  if (!caps.canSeeShowroom) {
    return (
      <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
        <NoAccess />
      </main>
    );
  }

  const sp = await searchParams;
  const ok = first(sp.ok);
  const err = first(sp.err);
  const actorId = await currentActorId();

  const items = await listShowroom(db, { take: MAX_SHOWROOM_PAGE });

  // Bounded picker: AVAILABLE units for «Отправить в шоу-рум».
  // ТЗ №16 §4 — плюс партии: основной источник, поимённых плит на складе почти
  // нет (ADR-004), поэтому раньше витрине было нечего показывать.
  const [availSlabs, availPieces, clients, batchRows] = await Promise.all([
    caps.canSendToShowroom
      ? db.slab.findMany({
          where: { status: "AVAILABLE", needsCheck: false },
          orderBy: [{ stoneType: { name: "asc" } }, { label: "asc" }],
          take: 100,
          select: {
            id: true,
            label: true,
            block: true,
            landmark: true,
            stoneType: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    caps.canSendToShowroom
      ? db.piece.findMany({
          where: { status: "AVAILABLE", needsCheck: false },
          orderBy: [{ stoneType: { name: "asc" } }, { id: "asc" }],
          take: 100,
          select: {
            id: true,
            kind: true,
            block: true,
            landmark: true,
            stoneType: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    caps.canSell
      ? db.client.findMany({
          where: caps.canSeeAllClients
            ? {}
            : actorId
              ? { managerId: actorId }
              : { managerId: "__none__" },
          orderBy: { name: "asc" },
          take: 100,
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    caps.canSendToShowroom
      ? db.batch.findMany({
          where: { needsCheck: false },
          orderBy: [
            { stoneType: { name: "asc" } },
            { arrivedAt: "desc" },
            { id: "desc" },
          ],
          take: 100,
          select: {
            id: true,
            slabsTotal: true,
            areaTotalM2: true,
            slabsSoldDirect: true,
            areaSoldDirectM2: true,
            slabsAdjusted: true,
            areaAdjustedM2: true,
            lengthMm: true,
            widthMm: true,
            stoneType: { select: { name: true } },
            slabs: { select: { areaM2: true } },
            pieces: { where: { originSlabId: null }, select: { areaM2: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  // Свободный остаток считаем той же формулой §3, что и домен (ADR-005) —
  // партия без свободных плит в списке не нужна: выделение всё равно откажет.
  const batches = batchRows
    .map((b) => {
      const free = computeFreeRemainder(
        {
          slabsTotal: b.slabsTotal,
          areaTotalM2: b.areaTotalM2 == null ? null : Number(b.areaTotalM2),
          slabsAdjusted: b.slabsAdjusted,
          areaAdjustedM2: Number(b.areaAdjustedM2),
          slabsSoldDirect: b.slabsSoldDirect,
          areaSoldDirectM2: Number(b.areaSoldDirectM2),
        },
        b.slabs.map((s) => ({ areaM2: s.areaM2 == null ? null : Number(s.areaM2) })),
        b.pieces.map((p) => ({ areaM2: p.areaM2 == null ? null : Number(p.areaM2) })),
      );
      return {
        id: b.id,
        stoneName: b.stoneType.name,
        slabsFree: free.slabsFree,
        areaFreeM2: free.areaFreeM2,
        gabarit: formatGabarit(b.lengthMm, b.widthMm),
      };
    })
    .filter((b) => b.slabsFree === null || b.slabsFree > 0);

  return (
    <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-ink">Шоу-рум</h1>
        <p className="mt-1 text-sm text-ink/60">
          Камень на витрине — не обычное наличие. Статус меняется при отправке;
          склад подтверждает физический перенос в «Отгрузках».
        </p>
      </header>

      {ok === "sent" && (
        <Alert variant="success" title="Готово" className="mb-3">
          Камень в статусе «шоу-рум». Задача на перенос — в «Отгрузки».
        </Alert>
      )}
      {ok === "returned" && (
        <Alert variant="success" title="Готово" className="mb-3">
          Камень возвращён на склад (AVAILABLE).
        </Alert>
      )}
      {ok === "sold" && (
        <Alert variant="success" title="Готово" className="mb-3">
          Продажа из шоу-рума оформлена.
        </Alert>
      )}
      {ok === "sampled" && (
        <Alert variant="success" title="Готово" className="mb-3">
          Выдан как образец — см. «Образцы».
        </Alert>
      )}
      {err && (
        <Alert variant="danger" title="Не удалось" className="mb-3">
          {err}
        </Alert>
      )}

      {caps.canSendToShowroom && (
        <Card className="mb-6">
          <h2 className="mb-2 text-base font-semibold text-ink">
            Отправить в шоу-рум
          </h2>
          {/* ТЗ №16 §4 — «Из партии»: основной путь. На складе поимённых плит
              почти нет (ADR-004), поэтому раньше в списке была одна плита и
              отправлять было нечего. Здесь плита выделяется из партии и уходит
              на витрину одной транзакцией. */}
          <form action={sendToShowroomAction} className="flex flex-col gap-3">
            <input type="hidden" name="source" value="BATCH" />
            <Field id="batchId" label="Из партии">
              <select
                name="batchId"
                required
                className={inputClass}
                defaultValue=""
              >
                <option value="" disabled>
                  Выберите партию…
                </option>
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.stoneName}
                    {b.gabarit !== "—" ? ` · ${b.gabarit}` : ""} · свободно{" "}
                    {b.slabsFree === null ? "—" : `${b.slabsFree} плит`}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              id="qty"
              name="qty"
              label="Сколько плит"
              inputMode="numeric"
              placeholder="1"
              defaultValue="1"
              className={inputClass}
            />
            <Field
              id="standNoteBatch"
              name="standNote"
              label="Стенд / комментарий"
              placeholder="Витрина у входа"
              className={inputClass}
            />
            {batches.length === 0 && (
              <p className="text-xs text-ink/50">
                Партий со свободными плитами нет.
              </p>
            )}
            <Button
              type="submit"
              className="min-h-12 w-full sm:w-auto"
              disabled={batches.length === 0}
            >
              Выделить и отправить
            </Button>
          </form>

          {/* ТЗ №16 §4 — «Готовая плита» и «Бой / остаток»: уже выделенные
              единицы. Раньше здесь стоял select `unitPick`, а действие ждало
              targetType/unitId, которые никто не заполнял (в подсказке так и
              было написано: «если форма не разобрала выбор…»). Теперь значение
              разбирает сервер. */}
          <form
            action={sendToShowroomAction}
            className="mt-5 flex flex-col gap-3 border-t border-line pt-4"
          >
            <input type="hidden" name="source" value="UNIT" />
            <Field id="unitPick" label="Готовая плита / бой-остаток">
              <select
                name="unitPick"
                required
                className={inputClass}
                defaultValue=""
              >
                <option value="" disabled>
                  Выберите…
                </option>
                {availSlabs.map((s) => (
                  <option key={s.id} value={`SLAB:${s.id}`}>
                    [Плита] {s.stoneType.name} — {s.label} (Бл. {s.block}/
                    {s.landmark})
                  </option>
                ))}
                {availPieces.map((p) => (
                  <option key={p.id} value={`PIECE:${p.id}`}>
                    [{p.kind === "BROKEN" ? "бой" : "ост."}]{" "}
                    {p.stoneType.name} (Бл. {p.block}/{p.landmark})
                  </option>
                ))}
              </select>
            </Field>
            <Field
              id="standNote"
              name="standNote"
              label="Стенд / комментарий"
              placeholder="Витрина у входа"
              className={inputClass}
            />
            <Button
              type="submit"
              variant="secondary"
              className="min-h-12 w-full sm:w-auto"
            >
              Отправить в шоу-рум
            </Button>
          </form>
          {/* Explicit per-unit send forms — reliable without client JS. */}
          <div className="mt-4 border-t border-line pt-3">
            <p className="mb-2 text-xs font-semibold text-ink/60">
              Быстрая отправка (плиты, до 20)
            </p>
            <ul className="flex flex-col gap-2">
              {availSlabs.slice(0, 20).map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-end gap-2 rounded-field border border-line p-2 text-sm"
                >
                  <span className="flex-1 font-medium text-ink">
                    {s.stoneType.name} — {s.label}
                  </span>
                  <form
                    action={sendToShowroomAction}
                    className="flex flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="targetType" value="SLAB" />
                    <input type="hidden" name="unitId" value={s.id} />
                    <input
                      name="standNote"
                      placeholder="Стенд"
                      className={inputClass + " min-w-[8rem]"}
                    />
                    <Button type="submit" size="sm">
                      В шоу-рум
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      <h2 className="mb-2 text-base font-semibold text-ink">
        Сейчас в шоу-руме
        {items.length > 0 && (
          <span className="ml-2 text-sm font-normal text-ink/55">
            {items.length}
            {items.length >= MAX_SHOWROOM_PAGE ? "+" : ""}
          </span>
        )}
      </h2>

      {items.length === 0 ? (
        <Card>
          <p className="text-ink/60">Пусто — отправьте камень на витрину.</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((it) => (
            <li key={it.placementId}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-ink">{it.stoneLabel}</p>
                    <Badge variant="warning">в шоу-руме</Badge>
                    {it.standNote && (
                      <p className="mt-1 text-sm text-ink">
                        Стенд: {it.standNote}
                      </p>
                    )}
                    <p className="text-sm text-ink/70">{it.location}</p>
                    <p className="mt-1 text-xs text-ink/55">
                      {it.sentByName} · {formatTashkentDateTime(it.sentAt)}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
                  <form action={returnFromShowroomAction}>
                    <input
                      type="hidden"
                      name="targetType"
                      value={it.targetType}
                    />
                    <input type="hidden" name="unitId" value={it.unitId} />
                    <Button type="submit" variant="secondary" size="sm">
                      Вернуть на склад
                    </Button>
                  </form>

                  {caps.canSell && (
                    <>
                      <form
                        action={sellFromShowroomAction}
                        className="flex flex-wrap items-end gap-2"
                      >
                        <input
                          type="hidden"
                          name="targetType"
                          value={it.targetType}
                        />
                        <input type="hidden" name="unitId" value={it.unitId} />
                        <Field
                          id={`cust-${it.placementId}`}
                          name="customerName"
                          label="Клиент (продажа)"
                          placeholder="Имя"
                          className={inputClass}
                        />
                        <Button type="submit" size="sm">
                          Продать из шоу-рума
                        </Button>
                      </form>

                      <form
                        action={sampleFromShowroomAction}
                        className="flex flex-col gap-2 rounded-field border border-line bg-paper-2 p-2"
                      >
                        <input
                          type="hidden"
                          name="targetType"
                          value={it.targetType}
                        />
                        <input type="hidden" name="unitId" value={it.unitId} />
                        <p className="text-xs font-semibold text-ink">
                          Выдать как образец
                        </p>
                        <label className="text-xs text-ink/60">
                          Клиент
                          <select
                            name="clientId"
                            required
                            className={inputClass + " mt-0.5"}
                            defaultValue=""
                          >
                            <option value="" disabled>
                              Выберите…
                            </option>
                            {clients.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs text-ink/60">
                          Вернуть до
                          <input
                            type="date"
                            name="returnDueDate"
                            required
                            className={inputClass + " mt-0.5"}
                          />
                        </label>
                        <Button type="submit" size="sm" variant="ghost">
                          Выдать образец
                        </Button>
                      </form>
                    </>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 text-sm text-ink/50">
        <Link href="/otgruzki" className="underline">
          Отгрузки
        </Link>
        {" · "}
        <Link href="/poisk" className="underline">
          Поиск
        </Link>
      </p>
    </main>
  );
}
