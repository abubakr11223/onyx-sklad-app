"use client";

// W1-T3 — «Продать из шоу-рума»: диалог вместо продажи одним кликом.
// Собирает те же поля, что основная форма продажи (prodazha/SaleForm):
// клиент из справочника (поиск + создание — те же server actions, та же
// нормализация телефона), цена (строгий money-парсер), валюта, способ оплаты,
// для «В долг» — срок/комментарий. Подтверждение — явный submit диалога.
// На ошибке валидации значения НЕ теряются: контролируемые поля + action
// возвращает состояние (useActionState), а не redirect.

import {
  useActionState,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  sellFromShowroomAction,
  type ShowroomSellState,
} from "./actions";
import {
  createClientForSale,
  searchClientsForSale,
  type ClientHit,
} from "@/app/prodazha/client-actions";
import { applyMoneyInputChange } from "@/app/prodazha/money-input";
import {
  CURRENCY_LABEL,
  PAYMENT_METHOD_LABEL,
  type PaymentMethod,
  type SaleCurrency,
} from "@/lib/validators/sale-payment";
import { CLIENT_TYPE_LABELS, type ClientType } from "@/lib/clients";
import { leftoverErrorMessages } from "@/lib/form-errors";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import Field, { inputClass } from "@/components/ui/Field";

const initialState: ShowroomSellState = { errors: {}, conflict: null };

/** Поля, которые диалог рисует у самих инпутов — остальное уходит в баннер. */
const RENDERED_KEYS = [
  "clientId",
  "price",
  "currency",
  "paymentMethod",
  "customerContact",
  "debtDueDate",
  "debtComment",
  "newClientName",
  "newClientPhone",
] as const;

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="mt-1 text-sm font-medium text-danger">{msg}</p>;
}

export default function ShowroomSellDialog({
  targetType,
  unitId,
  stoneLabel,
}: {
  targetType: "SLAB" | "PIECE";
  unitId: string;
  stoneLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    sellFromShowroomAction,
    initialState,
  );
  const e = state.errors;

  // ── Клиент из справочника (как SaleForm, TZ №10+11 §6) ──
  const [clientQuery, setClientQuery] = useState("");
  const [clientHits, setClientHits] = useState<ClientHit[]>([]);
  const [clientSearchBusy, setClientSearchBusy] = useState(false);
  const [clientSearchError, setClientSearchError] = useState<string | null>(null);
  const [selectedClient, setSelectedClient] = useState<ClientHit | null>(null);
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientType, setNewClientType] = useState<ClientType>("B2C");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [newClientBusy, setNewClientBusy] = useState(false);
  const [newClientError, setNewClientError] = useState<string | null>(null);
  const [dupHint, setDupHint] = useState<ClientHit | null>(null);

  // ── Оплата (TZ №9) ──
  /** Display only — с группировкой пробелами («200 000»). */
  const [priceDisplay, setPriceDisplay] = useState("");
  /** Digits for validator / hidden name="price" — never grouped. */
  const [priceSubmit, setPriceSubmit] = useState("");
  const priceInputRef = useRef<HTMLInputElement>(null);
  const priceCaretRef = useRef<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("");
  const [currency, setCurrency] = useState<SaleCurrency>("UZS");
  const [debtDueDate, setDebtDueDate] = useState("");
  const [debtComment, setDebtComment] = useState("");
  const isCredit = paymentMethod === "CREDIT";

  // Ошибки, которые ни одно поле не отрисовало (второй страховочный слой —
  // silent-form guard, см. src/lib/form-errors.ts). errors.form часто зеркалит
  // первую полевую ошибку (ensureFormError) — такие не дублируем в баннере.
  const renderedMsgs = new Set(
    RENDERED_KEYS.map((k) => e[k]).filter(Boolean),
  );
  const bannerMessages = leftoverErrorMessages(e, RENDERED_KEYS).filter(
    (msg) => !renderedMsgs.has(msg),
  );

  // Restore caret after re-grouping (как SaleForm — до отрисовки).
  useLayoutEffect(() => {
    const el = priceInputRef.current;
    const c = priceCaretRef.current;
    if (el && c !== null && document.activeElement === el) {
      el.setSelectionRange(c, c);
    }
    priceCaretRef.current = null;
  }, [priceDisplay]);

  const onPriceChange = (ev: ChangeEvent<HTMLInputElement>) => {
    const next = ev.target.value;
    const sel = ev.target.selectionStart;
    const { display, submit, caret } = applyMoneyInputChange(next, sel);
    priceCaretRef.current = caret;
    setPriceDisplay(display);
    setPriceSubmit(submit);
  };

  const selectClient = (c: ClientHit) => {
    setSelectedClient(c);
    setShowNewClient(false);
    setDupHint(null);
    setClientHits([]);
    setClientQuery("");
    setClientSearchError(null);
    setNewClientError(null);
  };

  const runClientSearch = async (raw?: string) => {
    const q = (raw ?? clientQuery).trim();
    if (q.length < 1) {
      setClientHits([]);
      setClientSearchError(null);
      return;
    }
    setClientSearchBusy(true);
    setClientSearchError(null);
    setDupHint(null);
    try {
      const res = await searchClientsForSale(q);
      if (!res.ok) {
        setClientSearchError(res.error);
        setClientHits([]);
      } else {
        setClientHits(res.clients);
        if (res.clients.length === 0) {
          setClientSearchError("Никого не найдено — создайте нового клиента");
        }
      }
    } finally {
      setClientSearchBusy(false);
    }
  };

  // Поиск по мере ввода (debounce), как в SaleForm (TZ №14 BUG-02).
  useEffect(() => {
    if (!open || selectedClient) return;
    const q = clientQuery.trim();
    if (q.length < 1) {
      /* eslint-disable react-hooks/set-state-in-effect -- сброс результатов внешнего поиска */
      setClientHits([]);
      setClientSearchError(null);
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }
    const t = window.setTimeout(() => {
      void runClientSearch(q);
    }, 280);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run on query
  }, [clientQuery, selectedClient, open]);

  const submitNewClient = async () => {
    setNewClientBusy(true);
    setNewClientError(null);
    setDupHint(null);
    try {
      // Та же нормализация телефона и защита от дублей, что в основной продаже.
      const res = await createClientForSale({
        name: newClientName,
        type: newClientType,
        phone: newClientPhone,
      });
      if (res.ok) {
        selectClient(res.client);
        setNewClientName("");
        setNewClientPhone("");
        setNewClientType("B2C");
        return;
      }
      if (res.reason === "duplicate") {
        setDupHint(res.existing);
        setNewClientError(res.error);
        return;
      }
      setNewClientError(res.error);
    } finally {
      setNewClientBusy(false);
    }
  };

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        Продать из шоу-рума
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Продажа: ${stoneLabel}`}
        labelledById={`showroom-sell-${unitId}`}
      >
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="targetType" value={targetType} />
          <input type="hidden" name="unitId" value={unitId} />
          <input type="hidden" name="clientId" value={selectedClient?.id ?? ""} />
          <input
            type="hidden"
            name="customerContact"
            value={selectedClient?.phone ?? ""}
          />
          <input type="hidden" name="price" value={priceSubmit} />
          <input type="hidden" name="paymentMethod" value={paymentMethod} />
          <input type="hidden" name="currency" value={currency} />
          <input type="hidden" name="debtDueDate" value={isCredit ? debtDueDate : ""} />
          <input type="hidden" name="debtComment" value={isCredit ? debtComment : ""} />

          {state.conflict && (
            <Alert variant="danger" title="Продажа не прошла">
              {state.conflict}
            </Alert>
          )}
          {bannerMessages.length > 0 && (
            <Alert variant="danger" title="Проверьте форму">
              {bannerMessages.map((msg) => (
                <p key={msg} className="text-sm">
                  {msg}
                </p>
              ))}
            </Alert>
          )}

          {/* ── Клиент ── */}
          <div>
            <p className="mb-1.5 text-sm font-semibold text-ink">
              Клиент <span className="text-danger">*</span>
            </p>
            {selectedClient ? (
              <div className="rounded-field border border-gold/40 bg-gold/10 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-ink">{selectedClient.name}</p>
                    <p className="text-sm text-ink/70">
                      {CLIENT_TYPE_LABELS[selectedClient.type]} ·{" "}
                      {selectedClient.phone}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedClient(null);
                      setDupHint(null);
                    }}
                  >
                    Сменить
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <input
                    id={`sell-client-search-${unitId}`}
                    className={inputClass}
                    placeholder="Поиск по имени или телефону…"
                    value={clientQuery}
                    onChange={(ev) => setClientQuery(ev.target.value)}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter") {
                        ev.preventDefault();
                        void runClientSearch();
                      }
                    }}
                    autoComplete="off"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={clientSearchBusy || !clientQuery.trim()}
                    onClick={() => void runClientSearch()}
                    className="shrink-0"
                  >
                    {clientSearchBusy ? "…" : "Найти"}
                  </Button>
                </div>
                <FieldError msg={e.clientId ?? clientSearchError ?? undefined} />
                {clientHits.length > 0 && (
                  <ul className="mt-2 max-h-48 overflow-auto rounded-field border border-line bg-paper">
                    {clientHits.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          className="w-full border-b border-line px-3 py-2.5 text-left last:border-0 active:bg-gold/10"
                          onClick={() => selectClient(c)}
                        >
                          <span className="font-semibold text-ink">{c.name}</span>
                          <span className="mt-0.5 block text-sm text-ink/65">
                            {CLIENT_TYPE_LABELS[c.type]} · {c.phone}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => {
                    setShowNewClient((v) => !v);
                    setDupHint(null);
                    setNewClientError(null);
                  }}
                >
                  {showNewClient ? "Скрыть форму" : "+ Новый клиент"}
                </Button>
              </>
            )}
          </div>

          {showNewClient && !selectedClient && (
            <div className="rounded-card border border-line bg-paper-2 p-3">
              <p className="mb-2 text-sm font-bold uppercase tracking-[0.06em] text-gold-deep">
                Новый клиент
              </p>
              <div className="flex flex-col gap-2">
                <Field
                  id={`sell-new-name-${unitId}`}
                  label="Имя / название"
                  placeholder="Иван Петров / ООО «Стройка»"
                  value={newClientName}
                  onChange={(ev) => setNewClientName(ev.target.value)}
                  error={e.newClientName}
                />
                <div>
                  <p className="mb-1.5 text-sm font-semibold text-ink">Тип</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(["B2C", "B2B"] as const).map((tp) => (
                      <label
                        key={tp}
                        className={
                          "flex min-h-11 cursor-pointer items-center justify-center rounded-field border text-sm font-semibold " +
                          (newClientType === tp
                            ? "border-gold bg-gold/15"
                            : "border-line bg-paper")
                        }
                      >
                        <input
                          type="radio"
                          className="sr-only"
                          checked={newClientType === tp}
                          onChange={() => setNewClientType(tp)}
                        />
                        {CLIENT_TYPE_LABELS[tp]}
                      </label>
                    ))}
                  </div>
                </div>
                <Field
                  id={`sell-new-phone-${unitId}`}
                  inputMode="tel"
                  label="Телефон"
                  placeholder="+998 90 …"
                  value={newClientPhone}
                  onChange={(ev) => setNewClientPhone(ev.target.value)}
                  error={e.newClientPhone}
                  autoComplete="tel"
                />
                {dupHint && (
                  <Alert variant="warning" title="Такой телефон уже есть" className="mt-1">
                    <p className="text-sm">
                      {dupHint.name} · {dupHint.phone}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      className="mt-2"
                      onClick={() => selectClient(dupHint)}
                    >
                      Выбрать этого клиента
                    </Button>
                  </Alert>
                )}
                <FieldError msg={newClientError ?? undefined} />
                <Button
                  type="button"
                  disabled={newClientBusy}
                  onClick={() => void submitNewClient()}
                  className="mt-1"
                >
                  {newClientBusy ? "Сохранение…" : "Сохранить клиента"}
                </Button>
              </div>
            </div>
          )}

          {/* ── Оплата (TZ №9) ── */}
          <fieldset className="rounded-card border border-line bg-paper p-3">
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
                id={`sell-price-${unitId}`}
                label={
                  <>
                    Цена продажи <span className="text-danger">*</span>
                  </>
                }
                error={e.price}
              >
                <input
                  ref={priceInputRef}
                  id={`sell-price-${unitId}`}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="200 000"
                  value={priceDisplay}
                  onChange={onPriceChange}
                  aria-invalid={e.price ? true : undefined}
                  className={`${inputClass} tnum`}
                />
              </Field>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold text-ink">
                  Валюта <span className="text-danger">*</span>
                </span>
                <div className="flex min-h-11 gap-1">
                  {(
                    [
                      ["UZS", CURRENCY_LABEL.UZS],
                      ["USD", CURRENCY_LABEL.USD],
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
                  id={`sell-debtDue-${unitId}`}
                  type="date"
                  label="Срок возврата долга"
                  value={debtDueDate}
                  onChange={(ev) => setDebtDueDate(ev.target.value)}
                  error={e.debtDueDate}
                  hint="Необязательно, но желательно"
                />
                <Field
                  id={`sell-debtComment-${unitId}`}
                  label="Комментарий к долгу"
                  placeholder="Например: доставка через неделю"
                  value={debtComment}
                  onChange={(ev) => setDebtComment(ev.target.value)}
                  error={e.debtComment}
                />
                <FieldError msg={e.customerContact} />
              </div>
            )}
          </fieldset>

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={pending} className="min-h-12">
              {pending ? "Оформляем…" : "Подтвердить продажу"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
