"use client";

// Форма продажи (TZ §5.4, §6.1 шаг 8, §6.2, §7.6) — телефонный флоу по шагам:
// вид камня → цель (плита / кусок / объём партии / вся партия) → клиент и
// цена → подтверждение. Конфликт («уже продан», чужая бронь, не хватает
// остатка) показывается КРУПНО (TZ §7.1).

import { useActionState, useState } from "react";
import { submitSale, type SaleFormState, type SaleMode } from "./actions";

export interface SlabOption {
  id: string;
  label: string;
  status: "AVAILABLE" | "RESERVED";
  needsCheck: boolean;
  /** «2800×1900 мм · 5,3 м²» — готовая строка с сервера. */
  detail: string;
  place: string;
  /** Имя менеджера активной брони (только для RESERVED). */
  reservedBy: string | null;
}

export interface PieceOption {
  id: string;
  kindRu: string;
  needsCheck: boolean;
  detail: string;
  place: string;
}

export interface BatchOption {
  id: string;
  title: string;
  /** «свободно: ~12 плит · ≈60 м²» — вычислено на сервере (ADR-005). */
  freeText: string;
  needsCheck: boolean;
  hasFree: boolean;
}

export interface StoneTypeGroup {
  id: string;
  name: string;
  rockType: string;
  slabs: SlabOption[];
  pieces: PieceOption[];
  batches: BatchOption[];
}

interface Target {
  mode: SaleMode;
  id: string;
  title: string;
  subtitle: string;
}

const initialState: SaleFormState = { errors: {}, conflict: null };

const inputCls =
  "h-14 w-full rounded-xl border border-gray-300 bg-white px-4 text-lg " +
  "focus:border-gray-900 focus:outline-none";
const labelCls = "mb-1 block text-base font-medium text-gray-700";
const cardBtnCls =
  "w-full rounded-xl border border-gray-200 bg-white p-3 text-left " +
  "active:bg-gray-100 disabled:opacity-50";

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="mt-1 text-sm font-medium text-red-600">{msg}</p>;
}

function NeedsCheckBadge() {
  return (
    <span className="ml-2 inline-block rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">
      требует проверки
    </span>
  );
}

function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-3 h-10 rounded-lg px-2 text-base font-medium text-gray-600"
    >
      ← {label}
    </button>
  );
}

export default function SaleForm({ stoneTypes }: { stoneTypes: StoneTypeGroup[] }) {
  const [state, formAction, pending] = useActionState(submitSale, initialState);
  const [stone, setStone] = useState<StoneTypeGroup | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerContact, setCustomerContact] = useState("");
  const [price, setPrice] = useState("");
  const [qtySlabs, setQtySlabs] = useState("");
  const [qtyAreaM2, setQtyAreaM2] = useState("");
  const e = state.errors;

  const pickTarget = (t: Target) => {
    setTarget(t);
    setConfirming(false);
  };

  // ── Шаг 1: вид камня ──
  if (!stone) {
    return (
      <section className="rounded-2xl bg-gray-50 p-4">
        <h2 className="mb-3 text-lg font-semibold">1. Вид камня</h2>
        {stoneTypes.length === 0 ? (
          <p className="text-gray-500">Продавать нечего — нет камня в наличии.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {stoneTypes.map((st) => {
              const parts = [
                st.slabs.length > 0 && `плит: ${st.slabs.length}`,
                st.pieces.length > 0 && `боя и остатков: ${st.pieces.length}`,
                st.batches.length > 0 && `партий: ${st.batches.length}`,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={st.id}>
                  <button type="button" className={cardBtnCls} onClick={() => setStone(st)}>
                    <span className="block text-base font-semibold">
                      {st.name}{" "}
                      <span className="font-normal text-gray-500">({st.rockType})</span>
                    </span>
                    <span className="block text-sm text-gray-600">{parts}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  }

  // ── Шаг 2: цель продажи ──
  if (!target) {
    return (
      <section className="rounded-2xl bg-gray-50 p-4">
        <BackButton onClick={() => setStone(null)} label="Вид камня" />
        <h2 className="mb-3 text-lg font-semibold">2. Что продаём — {stone.name}</h2>

        {stone.slabs.length > 0 && (
          <>
            <h3 className="mb-2 text-base font-semibold text-gray-700">Плиты</h3>
            <ul className="mb-4 flex flex-col gap-2">
              {stone.slabs.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={cardBtnCls}
                    disabled={s.needsCheck}
                    onClick={() =>
                      pickTarget({
                        mode: "SLAB",
                        id: s.id,
                        title: `${stone.name} — ${s.label}`,
                        subtitle: `${s.detail} · ${s.place}`,
                      })
                    }
                  >
                    <span className="block text-base font-semibold">
                      {s.label}
                      {s.status === "RESERVED" && s.reservedBy && (
                        <span className="ml-2 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                          бронь: {s.reservedBy}
                        </span>
                      )}
                      {s.needsCheck && <NeedsCheckBadge />}
                    </span>
                    <span className="block text-sm text-gray-600">
                      {s.detail} · {s.place}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {stone.pieces.length > 0 && (
          <>
            <h3 className="mb-2 text-base font-semibold text-gray-700">Бой и остатки</h3>
            <ul className="mb-4 flex flex-col gap-2">
              {stone.pieces.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={cardBtnCls}
                    disabled={p.needsCheck}
                    onClick={() =>
                      pickTarget({
                        mode: "PIECE",
                        id: p.id,
                        title: `${stone.name} — ${p.kindRu}`,
                        subtitle: `${p.detail} · ${p.place}`,
                      })
                    }
                  >
                    <span className="block text-base font-semibold">
                      {p.kindRu}
                      {p.needsCheck && <NeedsCheckBadge />}
                    </span>
                    <span className="block text-sm text-gray-600">
                      {p.detail} · {p.place}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {stone.batches.length > 0 && (
          <>
            <h3 className="mb-2 text-base font-semibold text-gray-700">
              Объём из партии (B2B, без выделения плит)
            </h3>
            <ul className="flex flex-col gap-2">
              {stone.batches.map((b) => (
                <li key={b.id} className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="text-base font-semibold">
                    {b.title}
                    {b.needsCheck && <NeedsCheckBadge />}
                  </div>
                  <div className="text-sm text-gray-600">{b.freeText}</div>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={b.needsCheck || !b.hasFree}
                      className="h-11 flex-1 rounded-lg bg-gray-900 px-3 text-sm font-semibold text-white disabled:opacity-40"
                      onClick={() =>
                        pickTarget({
                          mode: "BATCH_VOLUME",
                          id: b.id,
                          title: `${stone.name} — объём из партии`,
                          subtitle: `${b.title} · ${b.freeText}`,
                        })
                      }
                    >
                      Продать объём
                    </button>
                    <button
                      type="button"
                      disabled={b.needsCheck || !b.hasFree}
                      className="h-11 flex-1 rounded-lg border border-gray-900 px-3 text-sm font-semibold text-gray-900 disabled:opacity-40"
                      onClick={() =>
                        pickTarget({
                          mode: "WHOLE_BATCH",
                          id: b.id,
                          title: `${stone.name} — вся партия целиком`,
                          subtitle: `${b.title} · ${b.freeText}`,
                        })
                      }
                    >
                      Выкупить целиком
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {stone.slabs.length === 0 && stone.pieces.length === 0 && stone.batches.length === 0 && (
          <p className="text-gray-500">По этому виду продавать нечего.</p>
        )}
      </section>
    );
  }

  const isVolume = target.mode === "BATCH_VOLUME";
  const qtyText = [
    qtySlabs.trim() && `${qtySlabs.trim()} плит`,
    qtyAreaM2.trim() && `${qtyAreaM2.trim()} м²`,
  ]
    .filter(Boolean)
    .join(" / ");

  // ── Шаг 3: клиент и цена ──
  if (!confirming) {
    return (
      <section className="rounded-2xl bg-gray-50 p-4">
        <BackButton onClick={() => setTarget(null)} label="Выбор камня" />
        <h2 className="mb-1 text-lg font-semibold">3. Клиент и цена</h2>
        <p className="mb-3 text-sm text-gray-600">
          {target.title} · {target.subtitle}
        </p>

        {isVolume && (
          <div className="mb-3 grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="f-qtySlabs" className={labelCls}>
                Плит
              </label>
              <input
                id="f-qtySlabs"
                inputMode="numeric"
                className={inputCls}
                placeholder="10"
                value={qtySlabs}
                onChange={(ev) => setQtySlabs(ev.target.value)}
              />
              <FieldError msg={e.qtySlabs} />
            </div>
            <div>
              <label htmlFor="f-qtyArea" className={labelCls}>
                Площадь, м²
              </label>
              <input
                id="f-qtyArea"
                inputMode="decimal"
                className={inputCls}
                placeholder="55 или 12,5"
                value={qtyAreaM2}
                onChange={(ev) => setQtyAreaM2(ev.target.value)}
              />
              <FieldError msg={e.qtyAreaM2} />
            </div>
            <div className="col-span-2">
              <FieldError msg={e.qty} />
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <div>
            <label htmlFor="f-customer" className={labelCls}>
              Клиент <span className="text-red-600">*</span>
            </label>
            <input
              id="f-customer"
              className={inputCls}
              placeholder="Иван Петров / ООО «Стройка»"
              value={customerName}
              onChange={(ev) => setCustomerName(ev.target.value)}
            />
            <FieldError msg={e.customerName} />
          </div>
          <div>
            <label htmlFor="f-contact" className={labelCls}>
              Контакт
            </label>
            <input
              id="f-contact"
              className={inputCls}
              placeholder="+998 90 …"
              value={customerContact}
              onChange={(ev) => setCustomerContact(ev.target.value)}
            />
          </div>
          <div>
            <label htmlFor="f-price" className={labelCls}>
              Цена (необязательно)
            </label>
            <input
              id="f-price"
              inputMode="decimal"
              className={inputCls}
              placeholder="1500"
              value={price}
              onChange={(ev) => setPrice(ev.target.value)}
            />
            <FieldError msg={e.price} />
          </div>
        </div>

        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={!customerName.trim() || (isVolume && !qtySlabs.trim() && !qtyAreaM2.trim())}
          className="mt-4 h-14 w-full rounded-xl bg-gray-900 text-lg font-bold text-white disabled:opacity-40"
        >
          Далее — подтверждение
        </button>
      </section>
    );
  }

  // ── Шаг 4: подтверждение ──
  return (
    <section className="rounded-2xl bg-gray-50 p-4">
      <BackButton onClick={() => setConfirming(false)} label="Изменить данные" />
      <h2 className="mb-3 text-lg font-semibold">4. Подтверждение продажи</h2>

      {state.conflict && (
        <div
          role="alert"
          className="mb-4 rounded-2xl border-2 border-red-400 bg-red-50 p-4"
        >
          <p className="text-xl font-bold text-red-700">Продажа не прошла</p>
          <p className="mt-1 text-base text-red-800">{state.conflict}</p>
          <p className="mt-2 text-sm text-red-700">
            Обновите страницу, чтобы увидеть актуальное наличие.
          </p>
        </div>
      )}
      <FieldError msg={e.form} />

      <dl className="rounded-xl border border-gray-200 bg-white p-4 text-base">
        <div className="flex justify-between gap-3 py-1">
          <dt className="text-gray-500">Что</dt>
          <dd className="text-right font-semibold">{target.title}</dd>
        </div>
        <div className="flex justify-between gap-3 py-1">
          <dt className="text-gray-500">Детали</dt>
          <dd className="text-right text-sm text-gray-700">{target.subtitle}</dd>
        </div>
        {isVolume && qtyText && (
          <div className="flex justify-between gap-3 py-1">
            <dt className="text-gray-500">Объём</dt>
            <dd className="text-right font-semibold">{qtyText}</dd>
          </div>
        )}
        {target.mode === "WHOLE_BATCH" && (
          <div className="flex justify-between gap-3 py-1">
            <dt className="text-gray-500">Объём</dt>
            <dd className="text-right font-semibold">весь свободный остаток</dd>
          </div>
        )}
        <div className="flex justify-between gap-3 py-1">
          <dt className="text-gray-500">Клиент</dt>
          <dd className="text-right font-semibold">{customerName}</dd>
        </div>
        {customerContact.trim() && (
          <div className="flex justify-between gap-3 py-1">
            <dt className="text-gray-500">Контакт</dt>
            <dd className="text-right">{customerContact}</dd>
          </div>
        )}
        {price.trim() && (
          <div className="flex justify-between gap-3 py-1">
            <dt className="text-gray-500">Цена</dt>
            <dd className="text-right font-semibold">{price}</dd>
          </div>
        )}
      </dl>

      <form action={formAction}>
        <input type="hidden" name="mode" value={target.mode} />
        {target.mode === "SLAB" || target.mode === "PIECE" ? (
          <input type="hidden" name="unitId" value={target.id} />
        ) : (
          <input type="hidden" name="batchId" value={target.id} />
        )}
        <input type="hidden" name="customerName" value={customerName} />
        <input type="hidden" name="customerContact" value={customerContact} />
        <input type="hidden" name="price" value={price} />
        {isVolume && <input type="hidden" name="qtySlabs" value={qtySlabs} />}
        {isVolume && <input type="hidden" name="qtyAreaM2" value={qtyAreaM2} />}
        <button
          type="submit"
          disabled={pending}
          className="mt-4 h-16 w-full rounded-2xl bg-green-700 text-xl font-bold text-white disabled:opacity-50"
        >
          {pending ? "Оформление…" : "Подтвердить продажу"}
        </button>
      </form>
      <p className="mt-2 text-center text-sm text-gray-500">
        Камень списывается из наличия сразу в момент продажи (TZ §5.4).
      </p>
    </section>
  );
}
