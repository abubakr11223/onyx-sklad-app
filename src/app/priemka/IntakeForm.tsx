"use client";

// Форма приёмки партии (TZ §5.1, §6.3): партия целиком, без поимённых плит
// (ADR-004). Крупные touch-поля — складчик работает с телефона.
// C-pilot: разметка переведена на бренд-дизайн-систему (Button/Field/Card/Alert).
// Поведение, имена полей и контракт валидации НЕ менялись.

import { useActionState, useRef, useState } from "react";
import { submitIntake, type IntakeFormState } from "./actions";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field, { inputClass } from "@/components/ui/Field";
import Alert from "@/components/ui/Alert";

export interface StoneTypeOption {
  id: string;
  name: string;
  rockType: string;
}

const initialState: IntakeFormState = { errors: {} };

/** Звёздочка «обязательное поле». */
function Req() {
  return <span className="text-danger">*</span>;
}

/** Кросс-полевая ошибка (не привязана к одному input — quantity/locations). */
function CrossError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="text-sm font-medium text-danger">{msg}</p>;
}

export default function IntakeForm({
  stoneTypes,
  defaultDate,
}: {
  stoneTypes: StoneTypeOption[];
  defaultDate: string;
}) {
  const [state, formAction, pending] = useActionState(submitIntake, initialState);
  const [isNewType, setIsNewType] = useState(false);
  const [rowIds, setRowIds] = useState<number[]>([0]);
  const nextRowId = useRef(1);
  const e = state.errors;

  const addRow = () => {
    setRowIds((ids) => [...ids, nextRowId.current++]);
  };
  const removeRow = (id: number) => {
    setRowIds((ids) => (ids.length > 1 ? ids.filter((x) => x !== id) : ids));
  };

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {e.form && <Alert variant="danger">{e.form}</Alert>}

      {/* ── Вид камня ── */}
      <Card>
        <h2 className="mb-3 text-lg font-semibold text-ink">Вид камня</h2>
        <div className="mb-4 flex gap-2">
          <Button
            variant={isNewType ? "secondary" : "primary"}
            onClick={() => setIsNewType(false)}
            className="flex-1"
          >
            Из каталога
          </Button>
          <Button
            variant={isNewType ? "primary" : "secondary"}
            onClick={() => setIsNewType(true)}
            className="flex-1"
          >
            Новый вид
          </Button>
        </div>

        {isNewType ? (
          <div className="flex flex-col gap-4">
            <input type="hidden" name="newStoneType" value="1" />
            <Field
              id="newName"
              name="newName"
              label={<>Название <Req /></>}
              placeholder="Например: Травертин Noce"
              error={e.newName}
            />
            <Field
              id="newRockType"
              name="newRockType"
              label={<>Порода <Req /></>}
              placeholder="мрамор, гранит, оникс…"
              error={e.newRockType}
            />
            <Field id="newColor" name="newColor" label="Цвет" placeholder="бежевый" />
          </div>
        ) : (
          <Field id="stoneTypeId" label={<>Вид <Req /></>} error={e.stoneTypeId}>
            <select
              id="stoneTypeId"
              name="stoneTypeId"
              defaultValue=""
              className={inputClass}
              aria-invalid={e.stoneTypeId ? true : undefined}
              aria-describedby={e.stoneTypeId ? "stoneTypeId-error" : undefined}
            >
              <option value="" disabled>
                — выберите вид —
              </option>
              {stoneTypes.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name} ({st.rockType})
                </option>
              ))}
            </select>
          </Field>
        )}
      </Card>

      {/* ── Количество ── */}
      <Card>
        <h2 className="mb-1 text-lg font-semibold text-ink">Количество</h2>
        <p className="mb-4 text-sm text-ink/60">Плиты и/или площадь — минимум одно.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field
            id="slabsTotal"
            name="slabsTotal"
            inputMode="numeric"
            label="Плит"
            placeholder="40"
            error={e.slabsTotal}
          />
          <Field
            id="areaTotalM2"
            name="areaTotalM2"
            inputMode="decimal"
            label="Площадь, м²"
            placeholder="220 или 12,5"
            error={e.areaTotalM2}
          />
        </div>
        <div className="mt-1.5">
          <CrossError msg={e.quantity} />
        </div>
      </Card>

      {/* ── Локации ── */}
      <Card>
        <h2 className="mb-1 text-lg font-semibold text-ink">Локации</h2>
        <p className="mb-3 text-sm text-ink/60">
          Куда разгрузили. Одна партия может лежать в нескольких местах — это норма.
        </p>
        <div className="mb-3">
          <CrossError msg={e.locations} />
        </div>
        <div className="flex flex-col gap-4">
          {rowIds.map((id, idx) => (
            <div key={id} className="rounded-card border border-ink/10 bg-paper p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-base font-semibold text-ink">Локация {idx + 1}</span>
                {rowIds.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeRow(id)}
                    className="text-danger hover:bg-danger/10"
                  >
                    Убрать
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field
                  id={`locBlock-${idx}`}
                  name="locBlock"
                  label={<>Блок <Req /></>}
                  placeholder="А"
                  error={e[`loc-${idx}-block`]}
                />
                <Field
                  id={`locLandmark-${idx}`}
                  name="locLandmark"
                  label={<>Ориентир <Req /></>}
                  placeholder="2 или 1–2"
                  error={e[`loc-${idx}-landmark`]}
                />
                <Field
                  id={`locSlabsHere-${idx}`}
                  name="locSlabsHere"
                  inputMode="numeric"
                  label="Плит здесь"
                  placeholder="25"
                  error={e[`loc-${idx}-slabsHere`]}
                />
                <Field
                  id={`locAreaHereM2-${idx}`}
                  name="locAreaHereM2"
                  inputMode="decimal"
                  label="м² здесь"
                  placeholder="137,5"
                  error={e[`loc-${idx}-areaHereM2`]}
                />
              </div>
            </div>
          ))}
        </div>
        <Button
          variant="secondary"
          onClick={addRow}
          className="mt-3 w-full border-dashed"
        >
          + Добавить локацию
        </Button>
      </Card>

      {/* ── Детали ── */}
      <Card>
        <h2 className="mb-3 text-lg font-semibold text-ink">Детали</h2>
        <div className="flex flex-col gap-4">
          <Field
            id="arrivedAt"
            name="arrivedAt"
            type="date"
            defaultValue={defaultDate}
            label="Дата прихода"
            error={e.arrivedAt}
          />
          <Field
            id="supplierNote"
            name="supplierNote"
            label="Поставщик / документ"
            placeholder="Инвойс TR-118, контейнер…"
          />
        </div>
      </Card>

      {/* Липкая нижняя панель отправки — большой палец достаёт CTA на мобиле;
          на десктопе (md:) возвращается в обычный поток. Реальный submit
          формы (без JS) сохраняется — устойчивость к слабой сети. */}
      <div
        className="sticky bottom-0 z-10 -mx-4 border-t border-ink/10 bg-paper/90 px-4 py-3 backdrop-blur
                   md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-0 md:backdrop-blur-none"
      >
        <Button
          type="submit"
          disabled={pending}
          className="min-h-14 w-full text-lg font-bold"
        >
          {pending ? "Сохранение…" : "Принять партию"}
        </Button>
      </div>
    </form>
  );
}
