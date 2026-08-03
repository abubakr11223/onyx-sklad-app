"use client";

// Форма продажи (TZ §5.4, §6.1 шаг 8, §6.2, §7.6) — телефонный флоу по шагам:
// вид камня → цель (плита / кусок / объём партии / вся партия) → клиент и
// цена → подтверждение. Конфликт («уже продан», чужая бронь, не хватает
// остатка) показывается КРУПНО (TZ §7.1).
// BATCH-C: разметка переведена на бренд-дизайн-систему (Button/Field/Card/
// Alert/Badge). Поведение, имена полей и контракт валидации НЕ менялись.

import { useActionState, useEffect, useState } from "react";
import { submitSale, type SaleFormState, type SaleMode } from "./actions";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";
import {
  CURRENCY_LABEL,
  PAYMENT_METHOD_LABEL,
  type PaymentMethod,
  type SaleCurrency,
} from "@/lib/validators/sale-payment";
import { formatVolumeQtyDisplay } from "@/lib/validators/volume-qty";

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

/** ТЗ №3 — узор-подгруппа как цель продажи (B2C). */
export interface PatternOption {
  id: string;
  description: string;
  /** «осталось: 50 плит · 30 м²» — остаток узора (count − sold), с сервера. */
  remainText: string;
  hasFree: boolean;
}

export interface BatchOption {
  id: string;
  title: string;
  /** «свободно: ~12 плит · ≈60 м²» — вычислено на сервере (ADR-005). */
  freeText: string;
  needsCheck: boolean;
  hasFree: boolean;
  /** ТЗ №3 — узоры этой партии (если заведены). */
  patterns: PatternOption[];
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

// Крупная кликабельная карточка выбора (плита / кусок / вид камня) — не обычная
// Button: левое выравнивание, две строки. Стиль ввода/касания — бренд-токены.
const cardBtnCls =
  "w-full rounded-card border border-line bg-paper-2 p-3 text-left shadow-card " +
  "transition hover:-translate-y-0.5 hover:border-gold active:translate-y-0 " +
  "disabled:opacity-50 disabled:pointer-events-none disabled:shadow-none disabled:translate-y-0";

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="mt-1 text-sm font-medium text-danger">{msg}</p>;
}

// «требует проверки» — предупреждение (ЯНТАРНЫЙ), а не ошибка (TZ §7.1, аудит).
function NeedsCheckBadge() {
  return (
    <Badge variant="warning" className="ml-2 align-middle">
      требует проверки
    </Badge>
  );
}

function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} className="mb-3 -ml-1">
      ← {label}
    </Button>
  );
}

/** W7-B: deep-link bilan ochilganda boshlang'ich tanlov (server validatsiyadan). */
export type SaleFormInitialPick = {
  stoneTypeId: string;
  mode: SaleMode;
  unitId: string;
  title: string;
  subtitle: string;
};

function initialStoneAndTarget(
  stoneTypes: StoneTypeGroup[],
  initialPick: SaleFormInitialPick | null | undefined,
): { stone: StoneTypeGroup | null; target: Target | null } {
  if (!initialPick) return { stone: null, target: null };
  const st = stoneTypes.find((s) => s.id === initialPick.stoneTypeId) ?? null;
  if (!st) return { stone: null, target: null };
  // Plita/piece hali picker ro'yxatida bo'lishi shart (SOLD filterlangan).
  const inList =
    initialPick.mode === "SLAB"
      ? st.slabs.some((s) => s.id === initialPick.unitId && !s.needsCheck)
      : st.pieces.some((p) => p.id === initialPick.unitId && !p.needsCheck);
  if (!inList) return { stone: null, target: null };
  return {
    stone: st,
    target: {
      mode: initialPick.mode,
      id: initialPick.unitId,
      title: initialPick.title,
      subtitle: initialPick.subtitle,
    },
  };
}

export default function SaleForm({
  stoneTypes,
  initialPick = null,
}: {
  stoneTypes: StoneTypeGroup[];
  /** Server tomonda resolve qilingan preselect; null = oddiy ochilish. */
  initialPick?: SaleFormInitialPick | null;
}) {
  const boot = initialStoneAndTarget(stoneTypes, initialPick);
  const [state, formAction, pending] = useActionState(submitSale, initialState);
  const [stone, setStone] = useState<StoneTypeGroup | null>(boot.stone);
  const [target, setTarget] = useState<Target | null>(boot.target);
  const [confirming, setConfirming] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerContact, setCustomerContact] = useState("");
  const [price, setPrice] = useState("");
  // TZ9-A: способ оплаты + валюта (CONTRACT: CASH|CARD|CREDIT, UZS|USD).
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("");
  const [currency, setCurrency] = useState<SaleCurrency>("UZS");
  const [debtDueDate, setDebtDueDate] = useState("");
  const [debtComment, setDebtComment] = useState("");
  const [qtySlabs, setQtySlabs] = useState("");
  const [qtyAreaM2, setQtyAreaM2] = useState("");
  const e = state.errors;
  const isCredit = paymentMethod === "CREDIT";
  const hasSubmitError =
    Boolean(state.conflict) || Object.keys(state.errors).length > 0;

  // After a rejected submit, stay on confirmation (step 4) so the error is
  // where the user just pressed «Подтвердить». Controlled fields keep values.
  useEffect(() => {
    if (hasSubmitError && target) {
      setConfirming(true);
    }
  }, [hasSubmitError, state.conflict, state.errors, target]);

  const pickTarget = (t: Target) => {
    setTarget(t);
    setConfirming(false);
  };

  // ── Шаг 1: вид камня ──
  if (!stone) {
    return (
      <Card>
        <h2 className="mb-3 text-lg font-semibold text-ink">1. Вид камня</h2>
        {stoneTypes.length === 0 ? (
          <p className="text-ink/60">Продавать нечего — нет камня в наличии.</p>
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
                    <span className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gold/12 font-serif text-base font-bold text-gold-deep"
                      >
                        {(st.rockType || st.name).trim().charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-base font-semibold text-ink">
                          {st.name}{" "}
                          <span className="font-normal text-ink/60">({st.rockType})</span>
                        </span>
                        <span className="block text-sm text-ink/70">{parts}</span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    );
  }

  // ── Шаг 2: цель продажи ──
  if (!target) {
    return (
      <Card>
        <BackButton onClick={() => setStone(null)} label="Вид камня" />
        <h2 className="mb-3 text-lg font-semibold text-ink">2. Что продаём — {stone.name}</h2>

        {stone.slabs.length > 0 && (
          <>
            <h3 className="mb-2 text-base font-semibold text-ink/70">Плиты</h3>
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
                    <span className="block text-base font-semibold text-ink">
                      {s.label}
                      {s.status === "RESERVED" && s.reservedBy && (
                        <Badge variant="warning" className="ml-2 align-middle">
                          бронь: {s.reservedBy}
                        </Badge>
                      )}
                      {s.needsCheck && <NeedsCheckBadge />}
                    </span>
                    <span className="block text-sm text-ink/70">
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
            <h3 className="mb-2 text-base font-semibold text-ink/70">Бой и остатки</h3>
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
                    <span className="block text-base font-semibold text-ink">
                      {p.kindRu}
                      {p.needsCheck && <NeedsCheckBadge />}
                    </span>
                    <span className="block text-sm text-ink/70">
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
            <h3 className="mb-2 text-base font-semibold text-ink/70">
              Объём из партии (B2B, без выделения плит)
            </h3>
            <ul className="flex flex-col gap-2">
              {stone.batches.map((b) => (
                <li
                  key={b.id}
                  className="rounded-card border border-ink/10 bg-paper p-3"
                >
                  <div className="text-base font-semibold text-ink">
                    {b.title}
                    {b.needsCheck && <NeedsCheckBadge />}
                  </div>
                  <div className="text-sm text-ink/70">{b.freeText}</div>
                  <div className="mt-2 flex gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={b.needsCheck || !b.hasFree}
                      className="flex-1"
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
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={b.needsCheck || !b.hasFree}
                      className="flex-1"
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
                    </Button>
                  </div>

                  {/* ТЗ №3 — продажа из узора (B2C: клиент выбрал конкретный узор). */}
                  {b.patterns.length > 0 && (
                    <div className="mt-2 border-t border-line pt-2">
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-gold-deep">
                        Продать узор
                      </p>
                      <ul className="flex flex-col gap-1.5">
                        {b.patterns.map((pat) => (
                          <li key={pat.id} className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 text-sm">
                              <span className="font-medium text-ink">{pat.description}</span>
                              <span className="tnum text-ink/60"> · {pat.remainText}</span>
                            </span>
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={b.needsCheck || !pat.hasFree}
                              onClick={() =>
                                pickTarget({
                                  mode: "PATTERN_VOLUME",
                                  id: pat.id,
                                  title: `${stone.name} — узор «${pat.description}»`,
                                  subtitle: `${b.title} · ${pat.remainText}`,
                                })
                              }
                            >
                              Продать
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {stone.slabs.length === 0 && stone.pieces.length === 0 && stone.batches.length === 0 && (
          <p className="text-ink/60">По этому виду продавать нечего.</p>
        )}
      </Card>
    );
  }

  const isVolume =
    target.mode === "BATCH_VOLUME" || target.mode === "PATTERN_VOLUME";
  // Use " · " not " / " so "12 плит · 55 м²" cannot be misread as one number.
  const qtyText = formatVolumeQtyDisplay(qtySlabs, qtyAreaM2);

  // ── Шаг 3: клиент + оплата (TZ9 §3) ──
  // useEffect forces confirming=true after a failed submit so the user stays on
  // step 4 with the error. «Изменить данные» sets confirming=false freely.
  if (!confirming) {
    const canProceed =
      customerName.trim() &&
      paymentMethod !== "" &&
      price.trim() &&
      (!isCredit || customerContact.trim()) &&
      !(isVolume && !qtySlabs.trim() && !qtyAreaM2.trim());

    return (
      <Card>
        <BackButton onClick={() => setTarget(null)} label="Выбор камня" />
        <h2 className="mb-1 text-lg font-semibold text-ink">3. Клиент и оплата</h2>
        <p className="mb-3 text-sm text-ink/70">
          {target.title} · {target.subtitle}
        </p>

        {isVolume && (
          <div className="mb-3 grid grid-cols-2 gap-3">
            <Field
              id="f-qtySlabs"
              inputMode="numeric"
              label="Плит"
              placeholder="10"
              value={qtySlabs}
              onChange={(ev) => setQtySlabs(ev.target.value)}
              error={e.qtySlabs}
            />
            <Field
              id="f-qtyArea"
              inputMode="decimal"
              label="Площадь, м²"
              placeholder="12,5"
              value={qtyAreaM2}
              onChange={(ev) => setQtyAreaM2(ev.target.value)}
              error={e.qtyAreaM2}
              hint="Одно число, без пробелов (дробь: 12,5)"
            />
            <div className="col-span-2">
              <FieldError msg={e.qty} />
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <Field
            id="f-customer"
            label={
              <>
                Клиент <span className="text-danger">*</span>
              </>
            }
            placeholder="Иван Петров / ООО «Стройка»"
            value={customerName}
            onChange={(ev) => setCustomerName(ev.target.value)}
            error={e.customerName}
            autoComplete="name"
          />
          <Field
            id="f-contact"
            inputMode="tel"
            label={
              isCredit ? (
                <>
                  Телефон <span className="text-danger">*</span>
                </>
              ) : (
                "Телефон"
              )
            }
            placeholder="+998 90 …"
            value={customerContact}
            onChange={(ev) => setCustomerContact(ev.target.value)}
            error={e.customerContact}
            autoComplete="tel"
          />
        </div>

        {/* TZ9-A — блок «Оплата»: способ + цена + валюта; долг → срок/коммент. */}
        <fieldset className="mt-4 rounded-card border border-line bg-paper p-3">
          <legend className="px-1 text-sm font-bold uppercase tracking-[0.06em] text-gold-deep">
            Оплата
          </legend>

          <div className="mt-1">
            <p className="mb-2 text-sm font-semibold text-ink">
              Способ оплаты <span className="text-danger">*</span>
            </p>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["CASH", PAYMENT_METHOD_LABEL.CASH],
                  ["CARD", PAYMENT_METHOD_LABEL.CARD],
                  ["CREDIT", PAYMENT_METHOD_LABEL.CREDIT],
                ] as const
              ).map(([value, label]) => {
                const selected = paymentMethod === value;
                return (
                  <label
                    key={value}
                    className={
                      "flex min-h-11 cursor-pointer items-center justify-center rounded-field border px-1 text-center text-sm font-semibold transition " +
                      (selected
                        ? "border-gold bg-gold/15 text-ink shadow-card"
                        : "border-line bg-paper-2 text-ink/80 active:bg-gold/10")
                    }
                  >
                    <input
                      type="radio"
                      name="paymentMethodUi"
                      value={value}
                      checked={selected}
                      onChange={() => setPaymentMethod(value)}
                      className="sr-only"
                    />
                    {label}
                  </label>
                );
              })}
            </div>
            <FieldError msg={e.paymentMethod} />
          </div>

          <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
            <Field
              id="f-price"
              inputMode="decimal"
              label={
                <>
                  Цена продажи <span className="text-danger">*</span>
                </>
              }
              placeholder="1500"
              value={price}
              onChange={(ev) => setPrice(ev.target.value)}
              error={e.price}
            />
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold text-ink">
                Валюта <span className="text-danger">*</span>
              </span>
              <div className="flex min-h-11 gap-1">
                {(
                  [
                    ["UZS", "сум"],
                    ["USD", "$"],
                  ] as const
                ).map(([value, label]) => {
                  const selected = currency === value;
                  return (
                    <label
                      key={value}
                      className={
                        "flex min-h-11 min-w-12 cursor-pointer items-center justify-center rounded-field border px-2 text-sm font-bold transition " +
                        (selected
                          ? "border-gold bg-gold/15 text-ink"
                          : "border-line bg-paper-2 text-ink/70")
                      }
                    >
                      <input
                        type="radio"
                        name="currencyUi"
                        value={value}
                        checked={selected}
                        onChange={() => setCurrency(value)}
                        className="sr-only"
                      />
                      {label}
                    </label>
                  );
                })}
              </div>
              <FieldError msg={e.currency} />
            </div>
          </div>

          {isCredit && (
            <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
              <Field
                id="f-debtDue"
                type="date"
                label="Срок возврата долга"
                value={debtDueDate}
                onChange={(ev) => setDebtDueDate(ev.target.value)}
                error={e.debtDueDate}
                hint="Необязательно, но желательно"
              />
              <Field
                id="f-debtComment"
                label="Комментарий к долгу"
                placeholder="Например: доставка через неделю"
                value={debtComment}
                onChange={(ev) => setDebtComment(ev.target.value)}
                error={e.debtComment}
              />
            </div>
          )}
        </fieldset>

        <Button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={!canProceed}
          className="mt-4 min-h-14 w-full text-lg font-bold"
        >
          Далее — подтверждение
        </Button>
      </Card>
    );
  }

  // ── Шаг 4: подтверждение ──
  const fieldErrorItems = [
    e.form,
    e.qty,
    e.qtySlabs,
    e.qtyAreaM2,
    e.customerName,
    e.customerContact,
    e.paymentMethod,
    e.price,
    e.currency,
    e.debtDueDate,
    e.debtComment,
  ].filter((msg): msg is string => Boolean(msg));

  return (
    <Card>
      <BackButton
        onClick={() => setConfirming(false)}
        label="Изменить данные"
      />
      <h2 className="mb-3 text-lg font-semibold text-ink">
        4. Подтверждение продажи
      </h2>

      {/* Domain conflict (INSUFFICIENT_REMAINDER, ALREADY_SOLD, …) — large, top. */}
      {state.conflict && (
        <Alert variant="danger" title="Продажа не прошла" className="mb-4">
          <p className="text-base font-semibold">{state.conflict}</p>
          <p className="mt-2 text-sm">
            Данные формы сохранены. Исправьте объём или наличие («Изменить
            данные») и подтвердите снова. При сомнении обновите страницу.
          </p>
        </Alert>
      )}

      {/* Field / form validation — MUST include qty* (salebug: silent reject). */}
      {fieldErrorItems.length > 0 && (
        <Alert variant="danger" title="Продажа не оформлена" className="mb-4">
          <ul className="list-disc space-y-1 pl-4 text-sm">
            {fieldErrorItems.map((msg) => (
              <li key={msg}>{msg}</li>
            ))}
          </ul>
          <p className="mt-2 text-sm">
            Нажмите «Изменить данные», исправьте поля — введённые значения не
            сбрасываются.
          </p>
        </Alert>
      )}

      <dl className="rounded-card border border-ink/10 bg-paper p-4 text-base">
        <div className="flex justify-between gap-3 py-1">
          <dt className="text-ink/60">Что</dt>
          <dd className="text-right font-semibold text-ink">{target.title}</dd>
        </div>
        <div className="flex justify-between gap-3 py-1">
          <dt className="text-ink/60">Детали</dt>
          <dd className="text-right text-sm text-ink/70">{target.subtitle}</dd>
        </div>
        {isVolume && qtyText && (
          <div className="flex justify-between gap-3 py-1">
            <dt className="text-ink/60">Объём</dt>
            <dd className="text-right font-semibold text-ink">{qtyText}</dd>
          </div>
        )}
        {target.mode === "WHOLE_BATCH" && (
          <div className="flex justify-between gap-3 py-1">
            <dt className="text-ink/60">Объём</dt>
            <dd className="text-right font-semibold text-ink">весь свободный остаток</dd>
          </div>
        )}
        <div className="flex justify-between gap-3 py-1">
          <dt className="text-ink/60">Клиент</dt>
          <dd className="text-right font-semibold text-ink">{customerName}</dd>
        </div>
        {customerContact.trim() && (
          <div className="flex justify-between gap-3 py-1">
            <dt className="text-ink/60">Телефон</dt>
            <dd className="text-right text-ink">{customerContact}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3 py-1">
          <dt className="text-ink/60">Оплата</dt>
          <dd className="text-right font-semibold text-ink">
            {paymentMethod
              ? PAYMENT_METHOD_LABEL[paymentMethod]
              : "—"}
          </dd>
        </div>
        <div className="flex justify-between gap-3 py-1">
          <dt className="text-ink/60">Цена</dt>
          <dd className="tnum text-right font-semibold text-ink">
            {price.trim() || "—"} {CURRENCY_LABEL[currency]}
          </dd>
        </div>
        {isCredit && debtDueDate.trim() && (
          <div className="flex justify-between gap-3 py-1">
            <dt className="text-ink/60">Срок долга</dt>
            <dd className="text-right text-ink">{debtDueDate}</dd>
          </div>
        )}
        {isCredit && debtComment.trim() && (
          <div className="flex justify-between gap-3 py-1">
            <dt className="text-ink/60">Коммент. к долгу</dt>
            <dd className="text-right text-sm text-ink/80">{debtComment}</dd>
          </div>
        )}
      </dl>

      <form action={formAction}>
        <input type="hidden" name="mode" value={target.mode} />
        {target.mode === "SLAB" || target.mode === "PIECE" ? (
          <input type="hidden" name="unitId" value={target.id} />
        ) : target.mode === "PATTERN_VOLUME" ? (
          <input type="hidden" name="batchPatternId" value={target.id} />
        ) : (
          <input type="hidden" name="batchId" value={target.id} />
        )}
        <input type="hidden" name="customerName" value={customerName} />
        <input type="hidden" name="customerContact" value={customerContact} />
        <input type="hidden" name="price" value={price} />
        <input type="hidden" name="paymentMethod" value={paymentMethod} />
        <input type="hidden" name="currency" value={currency} />
        <input type="hidden" name="debtDueDate" value={debtDueDate} />
        <input type="hidden" name="debtComment" value={debtComment} />
        {isVolume && <input type="hidden" name="qtySlabs" value={qtySlabs} />}
        {isVolume && <input type="hidden" name="qtyAreaM2" value={qtyAreaM2} />}
        <Button
          type="submit"
          disabled={pending}
          className="mt-4 min-h-16 w-full text-xl font-bold"
        >
          {pending ? "Оформление…" : "Подтвердить продажу"}
        </Button>
      </form>
      <p className="mt-2 text-center text-sm text-ink/60">
        Камень списывается из наличия сразу в момент продажи (TZ §5.4).
        Способ оплаты на списание не влияет.
      </p>
    </Card>
  );
}
