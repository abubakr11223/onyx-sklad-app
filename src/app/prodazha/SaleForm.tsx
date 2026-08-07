"use client";

// Форма продажи (TZ §5.4, §6.1 шаг 8, §6.2, §7.6) — телефонный флоу по шагам:
// вид камня → цель (плита / кусок / объём партии / вся партия) → клиент и
// цена → подтверждение. Конфликт («уже продан», чужая бронь, не хватает
// остатка) показывается КРУПНО (TZ §7.1).
// BATCH-C: разметка переведена на бренд-дизайн-систему (Button/Field/Card/
// Alert/Badge). Поведение, имена полей и контракт валидации НЕ менялись.

import {
  useActionState,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { submitSale, type SaleFormState, type SaleMode } from "./actions";
import { fieldErrorItems as buildFieldErrorItems } from "./sale-form-errors";
import { issueSampleAction } from "@/app/obraztsy/actions";
import {
  createClientForSale,
  createSiteForSale,
  listSitesForClient,
  searchClientsForSale,
  type ClientHit,
  type SiteHit,
} from "./client-actions";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field, { inputClass } from "@/components/ui/Field";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";
import {
  CURRENCY_LABEL,
  PAYMENT_METHOD_LABEL,
  type PaymentMethod,
  type SaleCurrency,
} from "@/lib/validators/sale-payment";
import {
  CLIENT_TYPE_LABELS,
  SITE_TYPE_LABELS,
  type ClientType,
  type SiteType,
} from "@/lib/clients";
import { formatVolumeQtyDisplay } from "@/lib/validators/volume-qty";
import {
  applyMoneyInputChange,
  formatMoneyGrouped,
  normalizeMoneyForSubmit,
} from "./money-input";

export interface SlabOption {
  id: string;
  label: string;
  status: "AVAILABLE" | "RESERVED";
  needsCheck: boolean;
  /** «280×190 см · 5,3 м²» — готовая строка с сервера. */
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
  // TZ №10+11 §6 — клиент из справочника (не свободный текст).
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
  // Объект (необязательно)
  const [siteMode, setSiteMode] = useState<"none" | "existing" | "new">("none");
  const [sites, setSites] = useState<SiteHit[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [showNewSite, setShowNewSite] = useState(false);
  const [newSiteName, setNewSiteName] = useState("");
  const [newSiteType, setNewSiteType] = useState<SiteType>("RESIDENTIAL");
  const [newSiteAddress, setNewSiteAddress] = useState("");
  const [newSiteContact, setNewSiteContact] = useState("");
  const [newSiteBusy, setNewSiteBusy] = useState(false);
  const [newSiteError, setNewSiteError] = useState<string | null>(null);
  /** Display only — may contain grouping spaces («200 007 666»). */
  const [priceDisplay, setPriceDisplay] = useState("");
  /** Digits for validator / hidden name="price" — never grouped. */
  const [priceSubmit, setPriceSubmit] = useState("");
  const priceInputRef = useRef<HTMLInputElement>(null);
  const priceCaretRef = useRef<number | null>(null);
  // TZ9-A: способ оплаты + валюта (CONTRACT: CASH|CARD|CREDIT, UZS|USD).
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("");
  const [issueAsSample, setIssueAsSample] = useState(false);
  const [returnDueDateSample, setReturnDueDateSample] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [sampleComment, setSampleComment] = useState("");
  const [sampleState, sampleAction, samplePending] = useActionState(issueSampleAction, { errors: {}, conflict: null });
  const [currency, setCurrency] = useState<SaleCurrency>("UZS");
  const [debtDueDate, setDebtDueDate] = useState("");
  const [debtComment, setDebtComment] = useState("");
  const [qtySlabs, setQtySlabs] = useState("");
  const [qtyAreaM2, setQtyAreaM2] = useState("");
  const e = state.errors;
  const isCredit = paymentMethod === "CREDIT";
  const customerName = selectedClient?.name ?? "";
  const customerContact = selectedClient?.phone ?? "";
  const hasSubmitError =
    Boolean(state.conflict) || Object.keys(state.errors).length > 0;

  // After a rejected submit, stay on confirmation (step 4) so the error is
  // where the user just pressed «Подтвердить». Controlled fields keep values.
  useEffect(() => {
    if (hasSubmitError && target) {
      setConfirming(true);
    }
  }, [hasSubmitError, state.conflict, state.errors, target]);

  // Restore caret after re-grouping (useLayoutEffect = before paint, less jump).
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

  const pickTarget = (t: Target) => {
    setTarget(t);
    setConfirming(false);
  };

  const clearClient = () => {
    setSelectedClient(null);
    setSites([]);
    setSelectedSiteId("");
    setSiteMode("none");
    setShowNewSite(false);
    setDupHint(null);
  };

  const selectClient = async (c: ClientHit) => {
    setSelectedClient(c);
    setShowNewClient(false);
    setDupHint(null);
    setClientHits([]);
    setClientQuery("");
    setClientSearchError(null);
    setNewClientError(null);
    setSiteMode("none");
    setSelectedSiteId("");
    setShowNewSite(false);
    const res = await listSitesForClient(c.id);
    if (res.ok) setSites(res.sites);
    else setSites([]);
  };

  const runClientSearch = async () => {
    setClientSearchBusy(true);
    setClientSearchError(null);
    setDupHint(null);
    try {
      const res = await searchClientsForSale(clientQuery);
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

  const submitNewClient = async () => {
    setNewClientBusy(true);
    setNewClientError(null);
    setDupHint(null);
    try {
      const res = await createClientForSale({
        name: newClientName,
        type: newClientType,
        phone: newClientPhone,
      });
      if (res.ok) {
        await selectClient(res.client);
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

  const submitNewSite = async () => {
    if (!selectedClient) return;
    setNewSiteBusy(true);
    setNewSiteError(null);
    try {
      const res = await createSiteForSale({
        clientId: selectedClient.id,
        name: newSiteName,
        type: newSiteType,
        address: newSiteAddress,
        contactPerson: newSiteContact,
      });
      if (!res.ok) {
        setNewSiteError(res.error);
        return;
      }
      setSites((prev) => [...prev, res.site]);
      setSelectedSiteId(res.site.id);
      setSiteMode("existing");
      setShowNewSite(false);
      setNewSiteName("");
      setNewSiteAddress("");
      setNewSiteContact("");
    } finally {
      setNewSiteBusy(false);
    }
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
      Boolean(selectedClient) &&
      paymentMethod !== "" &&
      priceSubmit.trim() &&
      (!isCredit || (selectedClient?.phone ?? "").trim()) &&
      !(isVolume && !qtySlabs.trim() && !qtyAreaM2.trim()) &&
      !(siteMode === "existing" && !selectedSiteId);

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

        {/* TZ №10+11 §6 — клиент из справочника + объект (опц.) */}
        <div className="flex flex-col gap-3">
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
                      {CLIENT_TYPE_LABELS[selectedClient.type]} · {selectedClient.phone}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={clearClient}
                  >
                    Сменить
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <input
                    id="f-client-search"
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
                          onClick={() => void selectClient(c)}
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
            <FieldError msg={e.customerName} />
          </div>

          {showNewClient && !selectedClient && (
            <div className="rounded-card border border-line bg-paper-2 p-3">
              <p className="mb-2 text-sm font-bold uppercase tracking-[0.06em] text-gold-deep">
                Новый клиент
              </p>
              <div className="flex flex-col gap-2">
                <Field
                  id="f-new-name"
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
                  id="f-new-phone"
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
                      onClick={() => void selectClient(dupHint)}
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

          {selectedClient && (
            <div className="rounded-card border border-line bg-paper p-3">
              <p className="mb-2 text-sm font-bold uppercase tracking-[0.06em] text-gold-deep">
                Объект <span className="font-normal normal-case tracking-normal text-ink/50">(необязательно)</span>
              </p>
              <div className="flex flex-col gap-2">
                <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-field border border-line px-3">
                  <input
                    type="radio"
                    name="siteModeUi"
                    checked={siteMode === "none"}
                    onChange={() => {
                      setSiteMode("none");
                      setSelectedSiteId("");
                      setShowNewSite(false);
                    }}
                  />
                  <span className="text-sm font-semibold">Без объекта (частная продажа)</span>
                </label>
                <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-field border border-line px-3">
                  <input
                    type="radio"
                    name="siteModeUi"
                    checked={siteMode === "existing"}
                    onChange={() => {
                      setSiteMode("existing");
                      setShowNewSite(false);
                    }}
                  />
                  <span className="text-sm font-semibold">Выбрать объект клиента</span>
                </label>
                {siteMode === "existing" && (
                  <Field
                    id="f-site"
                    label="Объект"
                    error={e.siteId}
                  >
                    <select
                      id="f-site"
                      className={inputClass}
                      value={selectedSiteId}
                      onChange={(ev) => setSelectedSiteId(ev.target.value)}
                      aria-invalid={e.siteId ? true : undefined}
                    >
                      <option value="">— выберите —</option>
                      {sites.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                          {s.status === "COMPLETED" ? " (завершён)" : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowNewSite((v) => !v);
                    if (!showNewSite) setSiteMode("new");
                  }}
                >
                  {showNewSite ? "Скрыть" : "+ Новый объект"}
                </Button>
                {showNewSite && (
                  <div className="flex flex-col gap-2 border-t border-line pt-2">
                    <Field
                      id="f-new-site-name"
                      label="Название объекта"
                      placeholder="ЖК Ривьера"
                      value={newSiteName}
                      onChange={(ev) => setNewSiteName(ev.target.value)}
                      error={e.newSiteName}
                    />
                    <div>
                      <p className="mb-1.5 text-sm font-semibold text-ink">Тип</p>
                      <div className="grid grid-cols-3 gap-1">
                        {(
                          [
                            ["RESIDENTIAL", SITE_TYPE_LABELS.RESIDENTIAL],
                            ["COMMERCIAL", SITE_TYPE_LABELS.COMMERCIAL],
                            ["OTHER", SITE_TYPE_LABELS.OTHER],
                          ] as const
                        ).map(([tp, label]) => (
                          <label
                            key={tp}
                            className={
                              "flex min-h-11 cursor-pointer items-center justify-center rounded-field border px-1 text-center text-xs font-semibold " +
                              (newSiteType === tp
                                ? "border-gold bg-gold/15"
                                : "border-line bg-paper")
                            }
                          >
                            <input
                              type="radio"
                              className="sr-only"
                              checked={newSiteType === tp}
                              onChange={() => setNewSiteType(tp)}
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                    </div>
                    <Field
                      id="f-new-site-addr"
                      label="Адрес"
                      placeholder="необязательно"
                      value={newSiteAddress}
                      onChange={(ev) => setNewSiteAddress(ev.target.value)}
                    />
                    <Field
                      id="f-new-site-contact"
                      label="Контакт на объекте (прораб)"
                      placeholder="необязательно"
                      value={newSiteContact}
                      onChange={(ev) => setNewSiteContact(ev.target.value)}
                    />
                    <FieldError msg={newSiteError ?? undefined} />
                    <Button
                      type="button"
                      disabled={newSiteBusy || !newSiteName.trim()}
                      onClick={() => void submitNewSite()}
                    >
                      {newSiteBusy ? "Сохранение…" : "Сохранить объект"}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
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
              label={
                <>
                  Цена продажи <span className="text-danger">*</span>
                </>
              }
              error={e.price}
              hint="Пробелы — только для чтения; отправляется число без них"
            >
              <input
                ref={priceInputRef}
                id="f-price"
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

        <div className="mt-4 rounded-card border border-line bg-paper-2 p-3">
          <label className="flex min-h-11 cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={issueAsSample}
              onChange={(ev) => setIssueAsSample(ev.target.checked)}
            />
            <span className="text-sm font-semibold text-ink">
              Выдать как образец (не продажа)
            </span>
          </label>
          {issueAsSample && (
            <div className="mt-2 flex flex-col gap-2 border-t border-line pt-2">
              <Field
                id="f-sample-due"
                type="date"
                label={
                  <>
                    Срок возврата образца <span className="text-danger">*</span>
                  </>
                }
                value={returnDueDateSample}
                onChange={(ev) => setReturnDueDateSample(ev.target.value)}
                error={sampleState.errors.returnDueDate}
              />
              <Field
                id="f-deposit"
                inputMode="decimal"
                label="Залог (необязательно)"
                value={depositAmount}
                onChange={(ev) => setDepositAmount(ev.target.value)}
                placeholder="0"
              />
              <Field
                id="f-sample-comment"
                label="Комментарий"
                value={sampleComment}
                onChange={(ev) => setSampleComment(ev.target.value)}
              />
              <p className="text-xs text-ink/55">
                Камень спишется со склада как «образец» и исчезнет из поиска.
              </p>
            </div>
          )}
        </div>

        <Button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={
            issueAsSample
              ? !(selectedClient && returnDueDateSample)
              : !canProceed
          }
          className="mt-4 min-h-14 w-full text-lg font-bold"
        >
          {issueAsSample ? "Далее — выдача образца" : "Далее — подтверждение"}
        </Button>
      </Card>
    );
  }

  // ── Шаг 4: подтверждение ──
  const fieldErrorItems = buildFieldErrorItems(e);

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
          <dd className="text-right font-semibold text-ink">
            {selectedClient ? selectedClient.name : "—"}
          </dd>
        </div>
        {selectedClient && (
          <div className="flex justify-between gap-3 py-1">
            <dt className="text-ink/60">Телефон</dt>
            <dd className="text-right text-ink">{selectedClient.phone}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3 py-1">
          <dt className="text-ink/60">Объект</dt>
          <dd className="text-right text-ink">
            {siteMode === "existing" && selectedSiteId
              ? (sites.find((s) => s.id === selectedSiteId)?.name ?? "—")
              : "Без объекта"}
          </dd>
        </div>
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
            {priceDisplay.trim()
              ? formatMoneyGrouped(priceDisplay)
              : "—"}{" "}
            {CURRENCY_LABEL[currency]}
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

      <form action={issueAsSample ? sampleAction : formAction}>
        <input type="hidden" name="mode" value={target.mode} />
        {target.mode === "SLAB" || target.mode === "PIECE" ? (
          <input type="hidden" name="unitId" value={target.id} />
        ) : target.mode === "PATTERN_VOLUME" ? (
          <input type="hidden" name="batchPatternId" value={target.id} />
        ) : (
          <input type="hidden" name="batchId" value={target.id} />
        )}
        <input type="hidden" name="clientId" value={selectedClient?.id ?? ""} />
        <input
          type="hidden"
          name="siteId"
          value={siteMode === "existing" ? selectedSiteId : ""}
        />
        <input
          type="hidden"
          name="siteMode"
          value={siteMode === "existing" && selectedSiteId ? "existing" : "none"}
        />
        <input type="hidden" name="customerName" value={selectedClient?.name ?? ""} />
        <input
          type="hidden"
          name="customerContact"
          value={selectedClient?.phone ?? ""}
        />
        {issueAsSample ? (
          <>
            <input type="hidden" name="returnDueDate" value={returnDueDateSample} />
            <input type="hidden" name="depositAmount" value={depositAmount} />
            <input type="hidden" name="depositCurrency" value={currency} />
            <input type="hidden" name="sampleComment" value={sampleComment} />
          </>
        ) : (
          <>
            <input
              type="hidden"
              name="price"
              value={priceSubmit || normalizeMoneyForSubmit(priceDisplay)}
            />
            <input type="hidden" name="paymentMethod" value={paymentMethod} />
            <input type="hidden" name="currency" value={currency} />
            <input type="hidden" name="debtDueDate" value={debtDueDate} />
            <input type="hidden" name="debtComment" value={debtComment} />
          </>
        )}
        {isVolume && <input type="hidden" name="qtySlabs" value={qtySlabs} />}
        {isVolume && <input type="hidden" name="qtyAreaM2" value={qtyAreaM2} />}
        <Button
          type="submit"
          disabled={issueAsSample ? samplePending : pending}
          className="mt-4 min-h-16 w-full text-xl font-bold"
        >
          {issueAsSample
            ? samplePending
              ? "Выдача…"
              : "Подтвердить выдачу образца"
            : pending
              ? "Оформление…"
              : "Подтвердить продажу"}
        </Button>
      </form>
      {(sampleState.conflict || sampleState.errors.form) && (
        <Alert variant="danger" title="Образец не выдан" className="mt-3">
          {sampleState.conflict || sampleState.errors.form}
        </Alert>
      )}
      <p className="mt-2 text-center text-sm text-ink/60">
        Камень списывается из наличия сразу в момент продажи (TZ §5.4).
        Способ оплаты на списание не влияет.
      </p>
    </Card>
  );
}
