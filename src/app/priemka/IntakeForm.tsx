"use client";

// Форма приёмки партии (TZ §5.1, §6.3): партия целиком, без поимённых плит
// (ADR-004). Крупные touch-поля — складчик работает с телефона.

import { useActionState, useRef, useState } from "react";
import { submitIntake, type IntakeFormState } from "./actions";

export interface StoneTypeOption {
  id: string;
  name: string;
  rockType: string;
}

const initialState: IntakeFormState = { errors: {} };

const inputCls =
  "h-14 w-full rounded-xl border border-gray-300 bg-white px-4 text-lg " +
  "focus:border-gray-900 focus:outline-none";
const labelCls = "mb-1 block text-base font-medium text-gray-700";

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="mt-1 text-sm font-medium text-red-600">{msg}</p>;
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

  const toggleCls = (active: boolean) =>
    `h-12 flex-1 rounded-xl text-base font-semibold transition-colors ${
      active ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"
    }`;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <FieldError msg={e.form} />

      {/* ── Вид камня ── */}
      <section className="rounded-2xl bg-gray-50 p-4">
        <h2 className="mb-3 text-lg font-semibold">Вид камня</h2>
        <div className="mb-3 flex gap-2">
          <button type="button" className={toggleCls(!isNewType)} onClick={() => setIsNewType(false)}>
            Из каталога
          </button>
          <button type="button" className={toggleCls(isNewType)} onClick={() => setIsNewType(true)}>
            Новый вид
          </button>
        </div>

        {isNewType ? (
          <div className="flex flex-col gap-3">
            <input type="hidden" name="newStoneType" value="1" />
            <div>
              <label htmlFor="newName" className={labelCls}>
                Название <span className="text-red-600">*</span>
              </label>
              <input id="newName" name="newName" className={inputCls} placeholder="Например: Травертин Noce" />
              <FieldError msg={e.newName} />
            </div>
            <div>
              <label htmlFor="newRockType" className={labelCls}>
                Порода <span className="text-red-600">*</span>
              </label>
              <input id="newRockType" name="newRockType" className={inputCls} placeholder="мрамор, гранит, оникс…" />
              <FieldError msg={e.newRockType} />
            </div>
            <div>
              <label htmlFor="newColor" className={labelCls}>
                Цвет
              </label>
              <input id="newColor" name="newColor" className={inputCls} placeholder="бежевый" />
            </div>
          </div>
        ) : (
          <div>
            <label htmlFor="stoneTypeId" className={labelCls}>
              Вид <span className="text-red-600">*</span>
            </label>
            <select id="stoneTypeId" name="stoneTypeId" className={inputCls} defaultValue="">
              <option value="" disabled>
                — выберите вид —
              </option>
              {stoneTypes.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name} ({st.rockType})
                </option>
              ))}
            </select>
            <FieldError msg={e.stoneTypeId} />
          </div>
        )}
      </section>

      {/* ── Количество ── */}
      <section className="rounded-2xl bg-gray-50 p-4">
        <h2 className="mb-1 text-lg font-semibold">Количество</h2>
        <p className="mb-3 text-sm text-gray-500">Плиты и/или площадь — минимум одно.</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="slabsTotal" className={labelCls}>
              Плит
            </label>
            <input
              id="slabsTotal"
              name="slabsTotal"
              inputMode="numeric"
              className={inputCls}
              placeholder="40"
            />
            <FieldError msg={e.slabsTotal} />
          </div>
          <div>
            <label htmlFor="areaTotalM2" className={labelCls}>
              Площадь, м²
            </label>
            <input
              id="areaTotalM2"
              name="areaTotalM2"
              inputMode="decimal"
              className={inputCls}
              placeholder="220 или 12,5"
            />
            <FieldError msg={e.areaTotalM2} />
          </div>
        </div>
        <FieldError msg={e.quantity} />
      </section>

      {/* ── Локации ── */}
      <section className="rounded-2xl bg-gray-50 p-4">
        <h2 className="mb-1 text-lg font-semibold">Локации</h2>
        <p className="mb-3 text-sm text-gray-500">
          Куда разгрузили. Одна партия может лежать в нескольких местах — это норма.
        </p>
        <FieldError msg={e.locations} />
        <div className="flex flex-col gap-4">
          {rowIds.map((id, idx) => (
            <div key={id} className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-base font-semibold text-gray-700">Локация {idx + 1}</span>
                {rowIds.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRow(id)}
                    className="h-10 rounded-lg px-3 text-base font-medium text-red-600"
                  >
                    Убрать
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>
                    Блок <span className="text-red-600">*</span>
                  </label>
                  <input name="locBlock" className={inputCls} placeholder="А" />
                  <FieldError msg={e[`loc-${idx}-block`]} />
                </div>
                <div>
                  <label className={labelCls}>
                    Ориентир <span className="text-red-600">*</span>
                  </label>
                  <input name="locLandmark" className={inputCls} placeholder="2 или 1–2" />
                  <FieldError msg={e[`loc-${idx}-landmark`]} />
                </div>
                <div>
                  <label className={labelCls}>Плит здесь</label>
                  <input name="locSlabsHere" inputMode="numeric" className={inputCls} placeholder="25" />
                  <FieldError msg={e[`loc-${idx}-slabsHere`]} />
                </div>
                <div>
                  <label className={labelCls}>м² здесь</label>
                  <input name="locAreaHereM2" inputMode="decimal" className={inputCls} placeholder="137,5" />
                  <FieldError msg={e[`loc-${idx}-areaHereM2`]} />
                </div>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addRow}
          className="mt-3 h-12 w-full rounded-xl border-2 border-dashed border-gray-300 text-base font-semibold text-gray-600"
        >
          + Добавить локацию
        </button>
      </section>

      {/* ── Детали ── */}
      <section className="rounded-2xl bg-gray-50 p-4">
        <h2 className="mb-3 text-lg font-semibold">Детали</h2>
        <div className="flex flex-col gap-3">
          <div>
            <label htmlFor="arrivedAt" className={labelCls}>
              Дата прихода
            </label>
            <input id="arrivedAt" name="arrivedAt" type="date" defaultValue={defaultDate} className={inputCls} />
            <FieldError msg={e.arrivedAt} />
          </div>
          <div>
            <label htmlFor="supplierNote" className={labelCls}>
              Поставщик / документ
            </label>
            <input
              id="supplierNote"
              name="supplierNote"
              className={inputCls}
              placeholder="Инвойс TR-118, контейнер…"
            />
          </div>
        </div>
      </section>

      <button
        type="submit"
        disabled={pending}
        className="h-16 rounded-2xl bg-gray-900 text-xl font-bold text-white disabled:opacity-50"
      >
        {pending ? "Сохранение…" : "Принять партию"}
      </button>
    </form>
  );
}
