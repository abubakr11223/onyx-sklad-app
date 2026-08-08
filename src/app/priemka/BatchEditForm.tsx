"use client";

// ТЗ №14 §3 — форма правки партии (см). Количество readonly без canEditQuantity.

import { useActionState, useState } from "react";
import { submitBatchEdit, type BatchEditFormState } from "./edit-actions";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field, { inputClass } from "@/components/ui/Field";
import Alert from "@/components/ui/Alert";
import WarehouseGridDatalists from "@/components/WarehouseGridDatalists";

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
};

export type EditLocation = {
  block: string;
  landmark: string;
  slabsHere: number | null;
  areaHereM2: number | null;
};

export type EditBatchProps = {
  batchId: string;
  stoneName: string;
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

export default function BatchEditForm(props: EditBatchProps) {
  const [state, action, pending] = useActionState(submitBatchEdit, initial);
  const e = state.errors;
  const [locCount, setLocCount] = useState(
    Math.max(1, props.locations.length || 1),
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

      <WarehouseGridDatalists blocks={props.blocks} />

      {e.form && <Alert variant="danger">{e.form}</Alert>}

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
            defaultValue={n(props.slabsTotal)}
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
            defaultValue={nArea(props.areaTotalM2)}
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
            defaultValue={n(props.lengthMm)}
            error={e.lengthMm}
          />
          <Field
            id="widthMm"
            name="widthMm"
            label="Ширина, см"
            inputMode="numeric"
            defaultValue={n(props.widthMm)}
            error={e.widthMm}
          />
          <Field
            id="thicknessMm"
            name="thicknessMm"
            label="Толщина, см"
            inputMode="numeric"
            defaultValue={n(props.thicknessMm)}
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
            defaultValue={props.arrivedAtIso}
            error={e.arrivedAt}
          />
          <Field
            id="supplierNote"
            name="supplierNote"
            label="Поставщик / документ"
            defaultValue={props.supplierNote ?? ""}
          />
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
                  defaultValue={p.description}
                  error={e[`pat-${i}-desc`]}
                />
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Field
                    id={`patTh-${i}`}
                    name="patThickness"
                    label="Толщ., см"
                    inputMode="numeric"
                    defaultValue={n(p.thicknessMm)}
                    error={e[`pat-${i}-th`]}
                  />
                  <Field
                    id={`patLen-${i}`}
                    name="patLength"
                    label="Длина, см"
                    inputMode="numeric"
                    defaultValue={n(p.lengthMm)}
                    error={e[`pat-${i}-len`]}
                  />
                  <Field
                    id={`patWid-${i}`}
                    name="patWidth"
                    label="Ширина, см"
                    inputMode="numeric"
                    defaultValue={n(p.widthMm)}
                    error={e[`pat-${i}-wid`]}
                  />
                  <Field
                    id={`patSlabs-${i}`}
                    name="patSlabs"
                    label={`Плиты (продано ${p.slabsSold})`}
                    inputMode="numeric"
                    defaultValue={n(p.slabsCount)}
                    readOnly={!props.canEditQuantity}
                    error={e[`pat-${i}-slabs`]}
                  />
                  <Field
                    id={`patArea-${i}`}
                    name="patArea"
                    label={`м² (продано ${p.areaSoldM2})`}
                    inputMode="decimal"
                    defaultValue={nArea(p.areaM2)}
                    readOnly={!props.canEditQuantity}
                    error={e[`pat-${i}-area`]}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <h2 className="mb-3 text-lg font-semibold">Локации</h2>
        <div className="flex flex-col gap-3">
          {Array.from({ length: locCount }, (_, i) => {
            const loc = props.locations[i];
            return (
              <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Field
                  id={`locBlock-${i}`}
                  name="locBlock"
                  label="Блок"
                  defaultValue={loc?.block ?? ""}
                  list={props.blocks.length ? "wh-blocks" : undefined}
                  error={e[`loc-${i}`]}
                />
                <Field
                  id={`locLm-${i}`}
                  name="locLandmark"
                  label="Ориентир"
                  defaultValue={loc?.landmark ?? ""}
                />
                <Field
                  id={`locSlabs-${i}`}
                  name="locSlabs"
                  label="Плит здесь"
                  inputMode="numeric"
                  defaultValue={n(loc?.slabsHere ?? null)}
                />
                <Field
                  id={`locArea-${i}`}
                  name="locArea"
                  label="м² здесь"
                  inputMode="decimal"
                  defaultValue={nArea(loc?.areaHereM2 ?? null)}
                />
              </div>
            );
          })}
        </div>
        <Button
          type="button"
          variant="secondary"
          className="mt-3 w-full border-dashed"
          onClick={() => setLocCount((c) => c + 1)}
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
