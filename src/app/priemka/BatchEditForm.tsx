"use client";

// ТЗ №14 §3 — форма правки партии (см). Количество readonly без canEditQuantity.
//
// Поля КОНТРОЛИРУЕМЫЕ (value из state) — как в IntakeForm (BUG-01): React 19
// useActionState при возврате { errors } авто-сбрасывает только
// неконтролируемые input'ы; здесь значения живут в state и переживают ответ
// сервера. Файловые input'ы остаются неконтролируемыми (браузер не даёт
// программно восстановить выбранный файл).
//
// ТЗ №18 §3 — «Что здесь»: у каждой строки локации селект узора (как в
// приёмке). Строки существующих локаций несут hidden locId — сервер правит их
// НА МЕСТЕ, а не пересоздаёт: так переживают привязка узора и фотозапросы.

import { useActionState, useRef, useState } from "react";
import { submitBatchEdit, type BatchEditFormState } from "./edit-actions";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field, { inputClass } from "@/components/ui/Field";
import Alert from "@/components/ui/Alert";
import { batchEditErrorItems } from "./intake-form-errors";
import WarehouseLocationSelect from "@/components/WarehouseLocationSelect";

export type EditPattern = {
  id: string;
  description: string;
  thicknessMm: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  slabsCount: number;
  areaM2: number;
  slabsSold: number;
  areaSoldM2: number;
  /** Latest SAMPLE photo id (proxy /api/photo/[id]), if any. */
  photoId: string | null;
};

export type EditLocation = {
  /** id строки BatchLocation — правка на месте (фотозапросы, «Что здесь»). */
  id: string;
  block: string;
  landmark: string;
  slabsHere: number | null;
  areaHereM2: number | null;
  /** ТЗ №18 §3 — «Что здесь»: id узора; null = «весь приход». */
  batchPatternId: string | null;
};

export type EditBatchProps = {
  batchId: string;
  stoneName: string;
  /** ТЗ №16 B — уже приложенные фото партии (kind BATCH). */
  batchPhotos: Array<{ id: string }>;
  canEditQuantity: boolean;
  hasMovements: boolean;
  minSlabsHint: number | null;
  freeSlabs: number | null;
  freeArea: number | null;
  reservedSlabs: number;
  reservedArea: number;
  slabsTotal: number | null;
  areaTotalM2: number | null;
  slabsSoldDirect: number;
  areaSoldDirectM2: number;
  lengthMm: number | null;
  widthMm: number | null;
  thicknessMm: number | null;
  supplierNote: string | null;
  arrivedAtIso: string;
  patterns: EditPattern[];
  locations: EditLocation[];
  blocks: { letter: string; landmarks: string[] }[];
};

const initial: BatchEditFormState = { errors: {} };

function n(v: number | null | undefined): string {
  return v === null || v === undefined ? "" : String(v);
}

function nArea(v: number | null | undefined): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(".", ",");
}

/** Контролируемые значения одной строки локации. */
type LocRow = {
  /** React-key строки (стабилен при добавлении/удалении). */
  key: number;
  /** id существующей BatchLocation; null = новая строка. */
  id: string | null;
  block: string;
  landmark: string;
  slabsHere: string;
  areaHereM2: string;
  /** «Что здесь»: id узора; "" = весь приход. */
  pattern: string;
};

/** Контролируемые текстовые значения одного узора. */
type PatRow = {
  id: string;
  description: string;
  thicknessMm: string;
  lengthMm: string;
  widthMm: string;
  slabsCount: string;
  areaM2: string;
};

export default function BatchEditForm(props: EditBatchProps) {
  const [state, action, pending] = useActionState(submitBatchEdit, initial);
  const e = state.errors;

  const [vals, setVals] = useState(() => ({
    slabsTotal: n(props.slabsTotal),
    areaTotalM2: nArea(props.areaTotalM2),
    lengthMm: n(props.lengthMm),
    widthMm: n(props.widthMm),
    thicknessMm: n(props.thicknessMm),
    arrivedAt: props.arrivedAtIso,
    supplierNote: props.supplierNote ?? "",
  }));
  const setVal =
    (key: keyof typeof vals) => (ev: React.ChangeEvent<HTMLInputElement>) =>
      setVals((v) => ({ ...v, [key]: ev.target.value }));

  const [patRows, setPatRows] = useState<PatRow[]>(() =>
    props.patterns.map((p) => ({
      id: p.id,
      description: p.description,
      thicknessMm: n(p.thicknessMm),
      lengthMm: n(p.lengthMm),
      widthMm: n(p.widthMm),
      slabsCount: n(p.slabsCount),
      areaM2: nArea(p.areaM2),
    })),
  );
  const setPat =
    (idx: number, key: keyof Omit<PatRow, "id">) =>
    (ev: React.ChangeEvent<HTMLInputElement>) =>
      setPatRows((rows) =>
        rows.map((r, i) => (i === idx ? { ...r, [key]: ev.target.value } : r)),
      );

  const emptyLocRow = (key: number): LocRow => ({
    key,
    id: null,
    block: "",
    landmark: "",
    slabsHere: "",
    areaHereM2: "",
    pattern: "",
  });
  const [locRows, setLocRows] = useState<LocRow[]>(() => {
    const rows = props.locations.map((l, i) => ({
      key: i,
      id: l.id,
      block: l.block,
      landmark: l.landmark,
      slabsHere: n(l.slabsHere),
      areaHereM2: nArea(l.areaHereM2),
      pattern: l.batchPatternId ?? "",
    }));
    return rows.length > 0 ? rows : [emptyLocRow(0)];
  });
  const nextLocKey = useRef(Math.max(1, props.locations.length));
  const setLoc =
    (idx: number, key: keyof Omit<LocRow, "key" | "id">) => (value: string) =>
      setLocRows((rows) =>
        rows.map((r, i) => (i === idx ? { ...r, [key]: value } : r)),
      );

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="batchId" value={props.batchId} />
      <input
        type="hidden"
        name="expectedSlabsTotal"
        value={n(props.slabsTotal)}
      />
      <input
        type="hidden"
        name="expectedAreaTotalM2"
        value={nArea(props.areaTotalM2)}
      />
      <input
        type="hidden"
        name="expectedSlabsSoldDirect"
        value={String(props.slabsSoldDirect)}
      />
      <input
        type="hidden"
        name="expectedAreaSoldDirectM2"
        value={nArea(props.areaSoldDirectM2) || "0"}
      />
      <input type="hidden" name="expectedLengthMm" value={n(props.lengthMm)} />
      <input type="hidden" name="expectedWidthMm" value={n(props.widthMm)} />
      <input
        type="hidden"
        name="expectedThicknessMm"
        value={n(props.thicknessMm)}
      />
      <input
        type="hidden"
        name="expectedSupplierNote"
        value={props.supplierNote ?? ""}
      />
      <input type="hidden" name="expectedArrivedAt" value={props.arrivedAtIso} />


      {(() => {
        const banner = batchEditErrorItems(e);
        if (banner.length === 0) return null;
        return (
          <Alert variant="danger" title="Проверьте данные">
            {banner.length === 1 ? (
              <p className="text-base font-semibold">{banner[0]}</p>
            ) : (
              <ul className="list-disc space-y-1 pl-4 text-sm">
                {banner.map((msg) => (
                  <li key={msg}>{msg}</li>
                ))}
              </ul>
            )}
          </Alert>
        );
      })()}

      <Alert variant="info" title={props.stoneName}>
        {props.hasMovements ? (
          <p>
            По партии уже есть движения (продажа / бронь / бой / выделение).
            Количество можно менять
            {props.canEditQuantity ? "" : " только владельцу"}, но не ниже
            уже занятого.
            {props.minSlabsHint !== null && (
              <> Минимум плит: <strong>{props.minSlabsHint}</strong>.</>
            )}
          </p>
        ) : (
          <p>Движений нет — правки свободны (в пределах вашей роли).</p>
        )}
        {(props.freeSlabs !== null || props.freeArea !== null) && (
          <p className="mt-1 text-sm text-ink/70">
            Сейчас свободно:{" "}
            {props.freeSlabs !== null && `${props.freeSlabs} плит`}
            {props.freeSlabs !== null && props.freeArea !== null && " / "}
            {props.freeArea !== null &&
              `${props.freeArea.toFixed(2)} м²`}
            {(props.reservedSlabs > 0 || props.reservedArea > 0) &&
              ` (в брони/образцах: ${props.reservedSlabs} пл. / ${props.reservedArea.toFixed(2)} м²)`}
          </p>
        )}
        {!props.canEditQuantity && (
          <p className="mt-1 text-sm font-medium text-warning">
            Количество (плиты/м² и счётчики узоров) меняет только владелец.
            Размеры, дата, поставщик, локации — можно.
          </p>
        )}
      </Alert>

      <Card>
        <h2 className="mb-3 text-lg font-semibold">Количество</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field
            id="slabsTotal"
            name="slabsTotal"
            label="Плиты"
            inputMode="numeric"
            value={vals.slabsTotal}
            onChange={setVal("slabsTotal")}
            readOnly={!props.canEditQuantity}
            error={e.slabsTotal}
            hint={
              props.minSlabsHint !== null
                ? `Не меньше ${props.minSlabsHint}`
                : undefined
            }
          />
          <Field
            id="areaTotalM2"
            name="areaTotalM2"
            label="Площадь, м²"
            inputMode="decimal"
            value={vals.areaTotalM2}
            onChange={setVal("areaTotalM2")}
            readOnly={!props.canEditQuantity}
            error={e.areaTotalM2}
          />
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-semibold">Размеры плиты, см</h2>
        <div className="grid grid-cols-3 gap-3">
          <Field
            id="lengthMm"
            name="lengthMm"
            label="Длина, см"
            inputMode="numeric"
            value={vals.lengthMm}
            onChange={setVal("lengthMm")}
            error={e.lengthMm}
          />
          <Field
            id="widthMm"
            name="widthMm"
            label="Ширина, см"
            inputMode="numeric"
            value={vals.widthMm}
            onChange={setVal("widthMm")}
            error={e.widthMm}
          />
          <Field
            id="thicknessMm"
            name="thicknessMm"
            label="Толщина, см"
            inputMode="decimal"
            value={vals.thicknessMm}
            onChange={setVal("thicknessMm")}
            error={e.thicknessMm}
          />
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-semibold">Детали</h2>
        <div className="flex flex-col gap-3">
          <Field
            id="arrivedAt"
            name="arrivedAt"
            type="date"
            label="Дата прихода"
            value={vals.arrivedAt}
            onChange={setVal("arrivedAt")}
            error={e.arrivedAt}
          />
          <Field
            id="supplierNote"
            name="supplierNote"
            label="Поставщик / документ"
            value={vals.supplierNote}
            onChange={setVal("supplierNote")}
          />

          {/* ТЗ №16 B / §106 — фото партии доступно и в редактировании.
              Только добавление: §1.9 «фото хранится вечно, DELETE нет». */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="batchPhoto"
              className="text-sm font-semibold text-ink"
            >
              Фото партии
            </label>
            {props.batchPhotos.length > 0 && (
              <ul className="mb-1 flex flex-wrap gap-2">
                {props.batchPhotos.map((ph) => (
                  <li key={ph.id}>
                    <a
                      href={`/api/photo/${ph.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/photo/${ph.id}`}
                        alt="Фото партии"
                        loading="lazy"
                        className="h-16 w-16 rounded-lg object-cover"
                      />
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <input
              id="batchPhoto"
              name="batchPhoto"
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="block w-full text-sm text-ink/70 file:mr-3 file:rounded-field file:border-0 file:bg-gold/15 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-gold-deep hover:file:bg-gold/25"
            />
            <p className="text-xs text-ink/50">
              {props.batchPhotos.length > 0
                ? "Новые фото добавятся к существующим."
                : "Общий вид поставки — как камень пришёл."}
            </p>
          </div>
        </div>
      </Card>

      {props.patterns.length > 0 && (
        <Card>
          <h2 className="mb-3 text-lg font-semibold">Узоры / подгруппы</h2>
          <div className="flex flex-col gap-4">
            {props.patterns.map((p, i) => (
              <div
                key={p.id}
                className="rounded-card border border-ink/10 p-3"
              >
                <input type="hidden" name="patId" value={p.id} />
                <Field
                  id={`patDesc-${i}`}
                  name="patDesc"
                  label="Описание"
                  value={patRows[i]?.description ?? ""}
                  onChange={setPat(i, "description")}
                  error={e[`pat-${i}-desc`]}
                />
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Field
                    id={`patTh-${i}`}
                    name="patThickness"
                    label="Толщ., см"
                    inputMode="decimal"
                    value={patRows[i]?.thicknessMm ?? ""}
                    onChange={setPat(i, "thicknessMm")}
                    error={e[`pat-${i}-th`]}
                  />
                  <Field
                    id={`patLen-${i}`}
                    name="patLength"
                    label="Длина, см"
                    inputMode="numeric"
                    value={patRows[i]?.lengthMm ?? ""}
                    onChange={setPat(i, "lengthMm")}
                    error={e[`pat-${i}-len`]}
                  />
                  <Field
                    id={`patWid-${i}`}
                    name="patWidth"
                    label="Ширина, см"
                    inputMode="numeric"
                    value={patRows[i]?.widthMm ?? ""}
                    onChange={setPat(i, "widthMm")}
                    error={e[`pat-${i}-wid`]}
                  />
                  <Field
                    id={`patSlabs-${i}`}
                    name="patSlabs"
                    label={`Плиты (продано ${p.slabsSold})`}
                    inputMode="numeric"
                    value={patRows[i]?.slabsCount ?? ""}
                    onChange={setPat(i, "slabsCount")}
                    readOnly={!props.canEditQuantity}
                    error={e[`pat-${i}-slabs`]}
                  />
                  <Field
                    id={`patArea-${i}`}
                    name="patArea"
                    label={`м² (продано ${p.areaSoldM2})`}
                    inputMode="decimal"
                    value={patRows[i]?.areaM2 ?? ""}
                    onChange={setPat(i, "areaM2")}
                    readOnly={!props.canEditQuantity}
                    error={e[`pat-${i}-area`]}
                  />
                </div>
                {/* ТЗ №14 §3 — фото узора: тот же SAMPLE+batchPatternId путь, что приёмка. */}
                <div className="mt-3 flex flex-col gap-1.5">
                  <p className="text-sm font-semibold text-ink">Фото узора</p>
                  {p.photoId ? (
                    <p className="text-sm text-ink/70">
                      Сейчас:{" "}
                      <a
                        href={`/api/photo/${p.photoId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-gold-deep underline"
                      >
                        открыть
                      </a>
                    </p>
                  ) : (
                    <p className="text-sm text-ink/50">Фото ещё нет</p>
                  )}
                  <input
                    id={`patPhoto-${i}`}
                    name="patPhoto"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="block w-full text-sm text-ink/70 file:mr-3 file:rounded-field file:border-0 file:bg-gold/15 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-gold-deep hover:file:bg-gold/25"
                    aria-invalid={e[`pat-${i}-photo`] ? true : undefined}
                  />
                  {e[`pat-${i}-photo`] && (
                    <p className="text-sm font-medium text-danger">
                      {e[`pat-${i}-photo`]}
                    </p>
                  )}
                  {p.photoId && (
                    <label className="mt-1 flex min-h-11 items-center gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        name={`patPhotoClear-${p.id}`}
                        value="1"
                        className="h-5 w-5 accent-ink"
                      />
                      Снять фото с узора (строка Photo не удаляется — §1.9)
                    </label>
                  )}
                  <p className="text-xs text-ink/50">
                    Новое фото добавляется к узору (старое остаётся в архиве).
                    «Снять» отвязывает SAMPLE-фото от узора, файл в хранилище
                    сохраняется.
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <h2 className="mb-3 text-lg font-semibold">Локации</h2>
        <div className="flex flex-col gap-4">
          {locRows.map((loc, i) => (
            <div
              key={loc.key}
              className="rounded-card border border-ink/10 p-3"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-base font-semibold text-ink">
                  Локация {i + 1}
                </span>
                {locRows.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setLocRows((rows) => rows.filter((_, ri) => ri !== i))
                    }
                    className="text-danger hover:bg-danger/10"
                  >
                    Убрать
                  </Button>
                )}
              </div>
              {/* id существующей строки — сервер правит её на месте (фотозапросы
                  и «Что здесь» переживают правку); пусто = новая строка. */}
              <input type="hidden" name="locId" value={loc.id ?? ""} />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {/* ТЗ №17 §6 — локация только из карты склада (см. приёмку). */}
                <WarehouseLocationSelect
                  blocks={props.blocks}
                  index={i}
                  block={loc.block}
                  landmark={loc.landmark}
                  onBlockChange={(v) => {
                    setLocRows((rows) =>
                      rows.map((r, ri) =>
                        ri === i ? { ...r, block: v, landmark: "" } : r,
                      ),
                    );
                  }}
                  onLandmarkChange={setLoc(i, "landmark")}
                  blockError={e[`loc-${i}`]}
                />
                {/* ТЗ №18 §3 — «Что здесь»: какой узор лежит в этом месте.
                    Тот же селект, что в приёмке: список по описанию узора. */}
                {props.patterns.length > 0 && (
                  <div className="col-span-2 sm:col-span-4">
                    <Field id={`locPattern-${i}`} label="Что здесь">
                      <select
                        id={`locPattern-${i}`}
                        name="locPattern"
                        value={loc.pattern}
                        onChange={(ev) => setLoc(i, "pattern")(ev.target.value)}
                        className={inputClass}
                      >
                        <option value="">весь приход</option>
                        {patRows.map((p, pidx) => {
                          const desc = p.description.trim();
                          return (
                            <option key={p.id} value={p.id}>
                              {`Узор ${pidx + 1}${desc ? ` — ${desc}` : ""}`}
                            </option>
                          );
                        })}
                      </select>
                    </Field>
                  </div>
                )}
                <Field
                  id={`locSlabs-${i}`}
                  name="locSlabs"
                  label="Плит здесь"
                  inputMode="numeric"
                  value={loc.slabsHere}
                  onChange={(ev) => setLoc(i, "slabsHere")(ev.target.value)}
                />
                <Field
                  id={`locArea-${i}`}
                  name="locArea"
                  label="м² здесь"
                  inputMode="decimal"
                  value={loc.areaHereM2}
                  onChange={(ev) => setLoc(i, "areaHereM2")(ev.target.value)}
                />
              </div>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="secondary"
          className="mt-3 w-full border-dashed"
          onClick={() =>
            setLocRows((rows) => [...rows, emptyLocRow(nextLocKey.current++)])
          }
        >
          + Локация
        </Button>
      </Card>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending} className="min-h-14 flex-1">
          {pending ? "Сохранение…" : "Сохранить"}
        </Button>
        <a href="/priemka" className={inputClass + " flex min-h-14 flex-1 items-center justify-center text-center no-underline"}>
          Отмена
        </a>
      </div>
    </form>
  );
}
