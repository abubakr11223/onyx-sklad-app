"use client";

// Форма продажи (TZ §5.4, §6.1 шаг 8, §6.2, §7.6) — телефонный флоу по шагам:
// вид камня → цель (плита / кусок / объём партии / вся партия) → клиент и
// цена → подтверждение. Конфликт («уже продан», чужая бронь, не хватает
// остатка) показывается КРУПНО (TZ §7.1).
// BATCH-C: разметка переведена на бренд-дизайн-систему (Button/Field/Card/
// Alert/Badge). Поведение, имена полей и контракт валидации НЕ менялись.

import type { LeadSalePrefill } from "@/lib/partners";
import { PARTNER_TYPE_RU } from "@/lib/partner-labels";
import { PAY_METHODS, PAY_METHOD_LABEL, type PayMethod } from "@/lib/payment-rows";
import {
  useActionState,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { submitSale, type SaleFormState, type SaleMode } from "./actions";
import {
  fieldErrorItems as buildFieldErrorItems,
  sampleFieldErrorItems,
} from "./sale-form-errors";
import { issueSampleAction } from "@/app/obraztsy/actions";
import { emptyIssueSampleState } from "@/app/obraztsy/issue-sample-state";
import {
  createClientForSale,
  createSiteForSale,
  listSitesForClient,
  searchClientsForSale,
  type ClientHit,
  type SiteHit,
} from "./client-actions";
import SearchResults, { Highlight } from "@/components/ui/SearchResults";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field, { inputClass } from "@/components/ui/Field";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";
import {
  CURRENCY_LABEL,
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
  /**
   * W1-T1: имя клиента активной брони — только для кусков под СВОЕЙ бронью
   * (или все — для владельца); чужие RESERVED-куски сервер в список не кладёт.
   */
  reservedFor?: string | null;
}

/** W1-T1: своя активная volume-бронь на партию — для чекбокса «закрыть бронь». */
export interface MyVolumeReservation {
  id: string;
  /** «клиент: Иван, ≈10 м²» — готовая строка с сервера. */
  label: string;
}

/** ТЗ №19 — место хранения как источник списания («Блок A1 · 3 пл.»). */
export interface SourceLocationOption {
  id: string;
  label: string;
}

/** ТЗ №3 — узор-подгруппа как цель продажи (B2C). */
export interface PatternOption {
  id: string;
  description: string;
  /**
   * ТЗ №19 — единая строка источника с сервера:
   * «ТЕСТ светлый 2см · 280×160×2 см · свободно 3 пл. / 13,4 м² · Блок A1».
   */
  remainText: string;
  hasFree: boolean;
  /** ТЗ №19 B1 — места узора; больше одного → спрашиваем, откуда брать. */
  locations: SourceLocationOption[];
}

export interface BatchOption {
  id: string;
  title: string;
  /** «свободно: ~12 плит · ≈60 м²» — вычислено на сервере (ADR-005). */
  freeText: string;
  needsCheck: boolean;
  hasFree: boolean;
  /**
   * ТЗ №3 — узоры этой партии (если заведены). ТЗ №19 B1: есть узоры →
   * «Продать объём» скрыт, продажа только узором или «Выкупить целиком».
   */
  patterns: PatternOption[];
  /** ТЗ №19 — места однородной партии (выбор «откуда брать»). */
  locations: SourceLocationOption[];
  /** W1-T1: мои активные volume-брони на эту партию (для явного погашения). */
  myReservations: MyVolumeReservation[];
}

export interface StoneTypeGroup {
  id: string;
  name: string;
  rockType: string;
  slabs: SlabOption[];
  pieces: PieceOption[];
  batches: BatchOption[];
  /** ТЗ №20 C — ниже «Минимального остатка»: «4 плиты / 10» (null — не мало). */
  lowStock?: string | null;
  /** ТЗ №20 H — «Ориентир цены» («450 000 сум/м² · $35/м²»); только подсказка. */
  priceHint?: string | null;
}

interface Target {
  mode: SaleMode;
  id: string;
  title: string;
  subtitle: string;
  /** W1-T1: мои volume-брони на выбранную партию (объёмные режимы). */
  myReservations?: MyVolumeReservation[];
  /** ТЗ №19 — места источника (узора / однородной партии). */
  locations?: SourceLocationOption[];
}

/** ТЗ №20 A — строка «Оплата сейчас» (auto — сумма = цена, пока не правили). */
interface PayRowState {
  id: number;
  amount: string;
  method: PayMethod;
  auto: boolean;
}

/** Способ большей суммы — сводное поле продажи (отчёты считают по платежам). */
function summaryPayMethod(rows: { amount: number; method: PayMethod }[]): PayMethod {
  const by = new Map<PayMethod, number>();
  for (const r of rows) if (r.amount > 0) by.set(r.method, (by.get(r.method) ?? 0) + r.amount);
  return [...by.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "CASH";
}

const initialState: SaleFormState = { errors: {}, conflict: null };

// Крупная кликабельная карточка выбора (плита / кусок / вид камня) — не обычная
// Button: левое выравнивание, две строки. Стиль ввода/касания — бренд-токены.
const cardBtnCls =
  "w-full rounded-card border border-line bg-marble p-3 text-left " +
  "transition-colors duration-150 hover:-translate-y-0.5 hover:border-honey active:translate-y-0 " +
  "disabled:opacity-50 disabled:pointer-events-none disabled:shadow-none disabled:translate-y-0";

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="mt-1 text-sm font-medium text-carnelian">{msg}</p>;
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
  leadPrefill = null,
}: {
  stoneTypes: StoneTypeGroup[];
  /** Server tomonda resolve qilingan preselect; null = oddiy ochilish. */
  initialPick?: SaleFormInitialPick | null;
  /** ТЗ №20 L (§13.3) — продажа из заявки партнёра: камень, объём, объект. */
  leadPrefill?: LeadSalePrefill | null;
}) {
  const boot0 = initialStoneAndTarget(stoneTypes, initialPick);
  // Заявка партнёра: камень выбран сразу (партию/узор менеджер выбирает сам).
  const boot =
    !boot0.stone && leadPrefill
      ? { stone: stoneTypes.find((s) => s.id === leadPrefill.stoneTypeId) ?? null, target: null }
      : boot0;
  const [state, formAction, pending] = useActionState(submitSale, initialState);
  const [stone, setStone] = useState<StoneTypeGroup | null>(boot.stone);
  const [target, setTarget] = useState<Target | null>(boot.target);
  const [confirming, setConfirming] = useState(false);
  // ТЗ №19 B1 — из какого места брать (узор/партия лежит в нескольких).
  const [batchLocationId, setBatchLocationId] = useState("");
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
  // ТЗ №19 E1 — «есть клиент с таким именем» (телефон другой): создать можно,
  // но сначала показываем тёзок с телефонами.
  const [nameHint, setNameHint] = useState<ClientHit[] | null>(null);
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
  // ТЗ №20 A — «Оплата сейчас»: список платежей. По умолчанию одна строка,
  // сумма которой следует за ценой (auto), — обычная продажа без лишних действий.
  const [payRows, setPayRows] = useState<PayRowState[]>([
    { id: 0, amount: "", method: "CASH", auto: true },
  ]);
  const payRowSeq = useRef(1);
  const [issueAsSample, setIssueAsSample] = useState(false);
  const [returnDueDateSample, setReturnDueDateSample] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [sampleComment, setSampleComment] = useState("");
  const [sampleState, sampleAction, samplePending] = useActionState(
    issueSampleAction,
    emptyIssueSampleState(),
  );
  const [currency, setCurrency] = useState<SaleCurrency>("UZS");
  const [debtDueDate, setDebtDueDate] = useState("");
  // ТЗ №20 B — когда клиент заберёт (необязательно) и как.
  const [plannedDate, setPlannedDate] = useState("");
  const [plannedTime, setPlannedTime] = useState("");
  const [deliveryMode, setDeliveryMode] = useState<"" | "PICKUP" | "DELIVERY">("");
  const [debtComment, setDebtComment] = useState("");
  const [qtySlabs, setQtySlabs] = useState(leadPrefill?.qtySlabs ?? "");
  const [qtyAreaM2, setQtyAreaM2] = useState(leadPrefill?.qtyAreaM2 ?? "");

  // ТЗ №20 L — плашка «продажа по заявке партнёра» (шаги 2–4).
  const leadBanner = leadPrefill ? (
    <div className="mb-3 rounded-card border border-honey bg-honey-soft px-3 py-2 text-sm text-ink">
      <p className="font-semibold">
        Продажа по заявке партнёра: {leadPrefill.partnerName}
        {leadPrefill.partnerType ? ` (${PARTNER_TYPE_RU[leadPrefill.partnerType].toLowerCase()})` : ""}
      </p>
      <p className="text-ink-2">
        {[
          leadPrefill.stoneName,
          [leadPrefill.qtySlabs && `${leadPrefill.qtySlabs} плит`, leadPrefill.qtyAreaM2 && `${leadPrefill.qtyAreaM2} м²`]
            .filter(Boolean)
            .join(" · ") || null,
          leadPrefill.due ? `срок ${leadPrefill.due}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {leadPrefill.siteText && (
        <p className="text-ink-2">
          Объект из заявки: «{leadPrefill.siteText}» — выберите его у клиента в «Объект» или создайте новый.
        </p>
      )}
    </div>
  ) : null;
  // W1-T1: id СВОЕЙ брони, которую менеджер ЯВНО закрывает этой продажей.
  // По умолчанию пусто (галочка снята) — бронь остаётся в силе.
  const [consumeReservationId, setConsumeReservationId] = useState("");
  // ТЗ №20 §8: на широком экране (≥1280px) справа — липкая колонка «Итого».
  // Только отображение уже введённых значений; на отправку не влияет.
  // До монтирования (SSR, тесты в jsdom) — false: колонка не рисуется.
  const [isXl, setIsXl] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(min-width: 1280px)");
    const sync = () => setIsXl(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);
  const e = state.errors;
  const priceNum = Number(priceSubmit || normalizeMoneyForSubmit(priceDisplay)) || 0;
  const payRowsResolved = payRows.map((r) => ({
    method: r.method,
    amount: r.auto ? priceNum : Number(normalizeMoneyForSubmit(r.amount)) || 0,
  }));
  const paidTotal = payRowsResolved.reduce((s, r) => s + r.amount, 0);
  const debtLeft = Math.round((priceNum - paidTotal) * 100) / 100;
  const overpaid = debtLeft < 0;
  // Остаток в долг → срок/комментарий долга и обязательный телефон клиента.
  const isCredit = priceNum > 0 && debtLeft > 0;
  const paymentMethod: PaymentMethod | "" =
    priceNum <= 0 ? "" : paidTotal <= 0 ? "CREDIT" : summaryPayMethod(payRowsResolved);
  const paymentsJson = JSON.stringify(
    payRowsResolved.filter((r) => r.amount > 0),
  );
  const customerName = selectedClient?.name ?? "";
  const customerContact = selectedClient?.phone ?? "";
  const hasSubmitError =
    Boolean(state.conflict) || Object.keys(state.errors).length > 0;
  const hasSampleError =
    Boolean(sampleState.conflict) ||
    Object.keys(sampleState.errors).length > 0;
  /** Step-4 sample banner: preferred keys + leftovers (unknown keys never silent). */
  const sampleErrorList = [
    sampleState.conflict,
    ...sampleFieldErrorItems(sampleState.errors),
  ].filter((m): m is string => Boolean(m));
  // Dedupe while preserving order (form often mirrors first field error).
  const sampleErrorListUnique = [...new Set(sampleErrorList)];

  // After a rejected submit, stay on confirmation (step 4) so the error is
  // where the user just pressed «Подтвердить». Controlled fields keep values.
  // TZ14 BUG-01: same for sampleAction — field-only errors must not leave
  // the user on step 4 with no banner.
  //
  // react-hooks/set-state-in-effect ОСОЗНАННО подавлен (аудит 2026-08-10).
  // Правило право в общем случае, но переписывание этого шага на «производное
  // состояние» меняет ровно то поведение, которое чинили дважды: ошибка обязана
  // показываться на шаге, где нажали кнопку. Это самый регрессивный класс багов
  // в проекте (см. docs/tz-audit-2026-08-09.md §4, пять инцидентов).
  // Менять — только с ручным прогоном продажи в браузере, не «под линтер».
  useEffect(() => {
    if ((hasSubmitError || hasSampleError) && target) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect -- см. выше: сохраняем шаг с ошибкой */
      setConfirming(true);
    }
  }, [
    hasSubmitError,
    hasSampleError,
    state.conflict,
    state.errors,
    sampleState.conflict,
    sampleState.errors,
    target,
  ]);

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
    // W1-T1: согласие на закрытие брони относится к КОНКРЕТНОЙ партии —
    // при смене цели сбрасывается (deny-by-default).
    setConsumeReservationId("");
    setBatchLocationId(t.locations?.[0]?.id ?? "");
  };

  const clearClient = () => {
    setSelectedClient(null);
    setSites([]);
    setSelectedSiteId("");
    setSiteMode("none");
    setShowNewSite(false);
    setDupHint(null);
    setNameHint(null);
  };

  const selectClient = async (c: ClientHit) => {
    setSelectedClient(c);
    setShowNewClient(false);
    setDupHint(null);
    setNameHint(null);
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
    setNameHint(null);
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

  // TZ №14 BUG-02: выпадающий список по мере ввода (debounce), bounded take.
  // set-state-in-effect здесь — синхронизация с внешней системой (сетевой поиск):
  // очистка подсказок при пустом запросе и есть «отписка» от прошлого результата.
  useEffect(() => {
    if (selectedClient) return;
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
  }, [clientQuery, selectedClient]);

  const submitNewClient = async (allowSameName = false) => {
    setNewClientBusy(true);
    setNewClientError(null);
    setDupHint(null);
    setNameHint(null);
    try {
      const res = await createClientForSale({
        name: newClientName,
        type: newClientType,
        phone: newClientPhone,
        allowSameName,
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
      if (res.reason === "same_name") {
        setNameHint(res.similar);
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

  // ── Колонка «Итого» (≥1280px) ──
  const summaryRows: { label: string; value: string; strong?: boolean }[] = [];
  if (stone) summaryRows.push({ label: "Камень", value: stone.name, strong: true });
  if (target) {
    summaryRows.push({ label: "Что", value: target.title });
    const volumeMode =
      target.mode === "BATCH_VOLUME" || target.mode === "PATTERN_VOLUME";
    summaryRows.push({
      label: "Объём",
      value: volumeMode
        ? formatVolumeQtyDisplay(qtySlabs, qtyAreaM2) || "—"
        : target.mode === "WHOLE_BATCH"
          ? "весь свободный остаток"
          : target.subtitle || "—",
    });
    summaryRows.push({ label: "Клиент", value: selectedClient?.name ?? "—" });
    if (issueAsSample) {
      summaryRows.push({ label: "Тип", value: "Образец", strong: true });
      summaryRows.push({ label: "Срок возврата", value: returnDueDateSample || "—" });
    } else {
      summaryRows.push({
        label: "Сумма",
        value: priceDisplay.trim()
          ? `${formatMoneyGrouped(priceDisplay)} ${CURRENCY_LABEL[currency]}`
          : "—",
        strong: true,
      });
      const paidRows = payRowsResolved.filter((r) => r.amount > 0);
      summaryRows.push({
        label: "Оплата",
        value:
          priceNum <= 0
            ? "—"
            : (paidRows.length === 0
                ? "всё в долг"
                : paidRows
                    .map((r) => `${formatMoneyGrouped(String(r.amount))} ${PAY_METHOD_LABEL[r.method]}`)
                    .join(" + ")) +
              (isCredit ? ` · в долг ${formatMoneyGrouped(String(debtLeft))}` : ""),
      });
    }
  }
  const withSummary = (node: ReactNode) =>
    isXl ? (
      <div className="grid !max-w-none grid-cols-[minmax(0,760px)_320px] items-start gap-6">
        <div className="min-w-0">{node}</div>
        <aside aria-label="Итого" className="sticky top-6 self-start">
          <Card>
            <h2 className="mb-3 text-base font-semibold text-ink">Итого</h2>
            {summaryRows.length === 0 ? (
              <p className="text-sm text-ink-2">Выберите камень — здесь появится сводка.</p>
            ) : (
              <dl className="flex flex-col gap-3">
                {summaryRows.map((r) => (
                  <div key={r.label}>
                    <dt className="text-xs font-medium text-ink-2">{r.label}</dt>
                    <dd
                      className={
                        "tnum mt-0.5 text-sm " +
                        (r.strong ? "font-semibold text-ink" : "text-ink")
                      }
                    >
                      {r.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>
        </aside>
      </div>
    ) : (
      node
    );

  // ── Шаг 1: вид камня ──
  if (!stone) {
    return withSummary(
      <Card>
        <h2 className="mb-3 text-base font-semibold text-ink">1. Вид камня</h2>
        {stoneTypes.length === 0 ? (
          <p className="text-ink-2">Продавать нечего — нет камня в наличии.</p>
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
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-honey-soft text-base font-semibold text-honey-ink"
                      >
                        {(st.rockType || st.name).trim().charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-base font-semibold text-ink">
                          {st.name}{" "}
                          <span className="font-normal text-ink-2">({st.rockType})</span>
                          {st.lowStock && (
                            <>
                              {" "}
                              <Badge
                                variant="warning"
                                title={`Ниже минимального остатка: ${st.lowStock}`}
                              >
                                мало
                              </Badge>
                            </>
                          )}
                        </span>
                        <span className="block text-sm text-ink-2">{parts}</span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>,
    );
  }

  // ── Шаг 2: цель продажи ──
  if (!target) {
    return withSummary(
      <Card>
        {leadBanner}
        <BackButton onClick={() => setStone(null)} label="Вид камня" />
        <h2 className="mb-3 text-base font-semibold text-ink">
          2. Что продаём — {stone.name}
          {stone.lowStock && (
            <>
              {" "}
              <Badge variant="warning" className="align-middle">
                мало: {stone.lowStock}
              </Badge>
            </>
          )}
        </h2>

        {stone.slabs.length > 0 && (
          <>
            <h3 className="mb-2 text-base font-semibold text-ink-2">Плиты</h3>
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
                    <span className="block text-sm text-ink-2">
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
            <h3 className="mb-2 text-base font-semibold text-ink-2">Бой и остатки</h3>
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
                      {p.reservedFor && (
                        <Badge variant="warning" className="ml-2 align-middle">
                          Забронирован под: {p.reservedFor}
                        </Badge>
                      )}
                      {p.needsCheck && <NeedsCheckBadge />}
                    </span>
                    <span className="block text-sm text-ink-2">
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
            <h3 className="mb-2 text-base font-semibold text-ink-2">
              Объём из партии (B2B, без выделения плит)
            </h3>
            <ul className="flex flex-col gap-2">
              {stone.batches.map((b) => (
                <li
                  key={b.id}
                  className="rounded-card border border-line bg-marble p-3"
                >
                  <div className="text-base font-semibold text-ink">
                    {b.title}
                    {b.needsCheck && <NeedsCheckBadge />}
                  </div>
                  <div className="text-sm text-ink-2">{b.freeText}</div>
                  <div className="mt-2 flex gap-2">
                    {/* ТЗ №19 B1 — у партии с узорами «объём из партии» нет:
                        продажа не может обойти узор. */}
                    {b.patterns.length === 0 && (
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
                            myReservations: b.myReservations,
                            locations: b.locations,
                          })
                        }
                      >
                        Продать объём
                      </Button>
                    )}
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
                          myReservations: b.myReservations,
                        })
                      }
                    >
                      Выкупить целиком
                    </Button>
                  </div>

                  {/* ТЗ №3 — продажа из узора (B2C: клиент выбрал конкретный узор). */}
                  {b.patterns.length > 0 && (
                    <div className="mt-2 border-t border-line pt-2">
                      <p className="mb-1.5 text-xs font-semibold text-honey-ink">
                        Продать узор
                      </p>
                      <ul className="flex flex-col gap-1.5">
                        {b.patterns.map((pat) => (
                          <li key={pat.id} className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 text-sm">
                              <span className="font-medium text-ink">{pat.description}</span>
                              <span className="tnum text-ink-2"> · {pat.remainText}</span>
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
                                  myReservations: b.myReservations,
                                  locations: pat.locations,
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
          <p className="text-ink-2">По этому виду продавать нечего.</p>
        )}
      </Card>,
    );
  }

  const isVolume =
    target.mode === "BATCH_VOLUME" || target.mode === "PATTERN_VOLUME";
  // W1-T1: продажа из объёма партии (в т.ч. «целиком») может ЯВНО закрыть
  // свою бронь; на единичные SLAB/PIECE чекбокс не распространяется.
  const isBatchSale = isVolume || target.mode === "WHOLE_BATCH";
  const myReservations = isBatchSale ? (target.myReservations ?? []) : [];
  const consumedReservation =
    myReservations.find((r) => r.id === consumeReservationId) ?? null;
  // Use " · " not " / " so "12 плит · 55 м²" cannot be misread as one number.
  const qtyText = formatVolumeQtyDisplay(qtySlabs, qtyAreaM2);

  // ── Шаг 3: клиент + оплата (TZ9 §3) ──
  // useEffect forces confirming=true after a failed submit so the user stays on
  // step 4 with the error. «Изменить данные» sets confirming=false freely.
  if (!confirming) {
    const canProceed =
      Boolean(selectedClient) &&
      paymentMethod !== "" &&
      !overpaid &&
      priceSubmit.trim() &&
      (!isCredit || (selectedClient?.phone ?? "").trim()) &&
      !(isVolume && !qtySlabs.trim() && !qtyAreaM2.trim()) &&
      !(siteMode === "existing" && !selectedSiteId);

    return withSummary(
      <Card>
        {leadBanner}
        <BackButton onClick={() => setTarget(null)} label="Выбор камня" />
        <h2 className="mb-1 text-base font-semibold text-ink">3. Клиент и оплата</h2>
        <p className="mb-3 text-sm text-ink-2">
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

        {/* ТЗ №19 B1 — «если локаций несколько — спросить, из какой». */}
        {isVolume && (target.locations?.length ?? 0) > 1 && (
          <div className="mb-3">
            <label htmlFor="f-batchLocation" className="mb-1.5 block text-sm font-semibold text-ink">
              Откуда брать
            </label>
            <select
              id="f-batchLocation"
              className={inputClass}
              value={batchLocationId}
              onChange={(ev) => setBatchLocationId(ev.target.value)}
            >
              {target.locations!.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-ink-2">
              Если здесь меньше плит, чем продаёте, остаток возьмётся из других мест узора.
            </p>
          </div>
        )}

        {/* W1-T1: явное закрытие СВОЕЙ volume-брони этой продажей. Без галочки
            бронь остаётся hold'ом и её объём в продажу не входит. */}
        {myReservations.length > 0 && (
          <div className="mb-3 rounded-card border border-honey bg-honey-soft p-3">
            <p className="mb-1.5 text-sm font-semibold text-ink">
              У вас есть бронь на эту партию
            </p>
            <div className="flex flex-col gap-1">
              {myReservations.map((r) => (
                <label
                  key={r.id}
                  className="flex min-h-11 cursor-pointer items-center gap-2"
                >
                  <input
                    type="checkbox"
                    checked={consumeReservationId === r.id}
                    onChange={(ev) =>
                      setConsumeReservationId(ev.target.checked ? r.id : "")
                    }
                  />
                  <span className="text-sm text-ink">
                    Закрыть мою бронь ({r.label}) этой продажей
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-ink-2">
              Без галочки бронь остаётся в силе, и её объём не участвует в этой
              продаже.
            </p>
          </div>
        )}

        {/* TZ №10+11 §6 — клиент из справочника + объект (опц.) */}
        <div className="flex flex-col gap-3">
          <div>
            <p className="mb-1.5 text-sm font-semibold text-ink">
              Клиент <span className="text-carnelian">*</span>
            </p>
            {selectedClient ? (
              <div className="rounded-field border border-honey bg-honey-soft p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-ink">{selectedClient.name}</p>
                    <p className="text-sm text-ink-2">
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
                  <SearchResults
                    className="mt-2"
                    items={clientHits.map((c) => ({
                      key: c.id,
                      onSelect: () => void selectClient(c),
                      content: (
                        <span className="min-w-0 truncate">
                          <span className="font-normal"><Highlight text={c.name} query={clientQuery} /></span>
                          <span className="tnum text-ink-2">
                            {" · "}{CLIENT_TYPE_LABELS[c.type]} · <Highlight text={c.phone} query={clientQuery} />
                          </span>
                        </span>
                      ),
                    }))}
                  />
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => {
                    setShowNewClient((v) => !v);
                    setDupHint(null);
                    setNameHint(null);
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
            <div className="rounded-card border border-line bg-marble p-3">
              <p className="mb-2 text-base font-semibold text-ink">
                Новый клиент
              </p>
              <div className="flex flex-col gap-2">
                <Field
                  id="f-new-name"
                  label="Имя / название"
                  placeholder="Иван Петров / ООО «Стройка»"
                  value={newClientName}
                  onChange={(ev) => {
                    setNewClientName(ev.target.value);
                    setNameHint(null);
                  }}
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
                            ? "border-honey bg-honey-soft"
                            : "border-line bg-marble")
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
                {nameHint && nameHint.length > 0 && (
                  <Alert variant="warning" title="Есть клиент с таким именем" className="mt-1">
                    <p className="text-sm">
                      Проверьте телефон: если это он — выберите. Если другой человек —
                      «Всё равно создать».
                    </p>
                    <ul className="mt-2 flex flex-col gap-2">
                      {nameHint.map((c) => (
                        <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm">
                            <span className="font-semibold text-ink">{c.name}</span> · {c.phone}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => void selectClient(c)}
                          >
                            Выбрать
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </Alert>
                )}
                <FieldError msg={newClientError ?? undefined} />
                <Button
                  type="button"
                  disabled={newClientBusy}
                  onClick={() => void submitNewClient(nameHint !== null)}
                  className="mt-1"
                >
                  {newClientBusy
                    ? "Сохранение…"
                    : nameHint
                      ? "Всё равно создать"
                      : "Сохранить клиента"}
                </Button>
              </div>
            </div>
          )}

          {selectedClient && (
            <div className="rounded-card border border-line bg-marble p-3">
              <p className="mb-2 text-base font-semibold text-ink">
                Объект <span className="font-normal normal-case tracking-normal text-ink-3">(необязательно)</span>
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
                                ? "border-honey bg-honey-soft"
                                : "border-line bg-marble")
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

        {/* ТЗ №20 B — плановая отгрузка: складчик готовит камень заранее.
            Пусто = «как можно скорее», как раньше. */}
        {!issueAsSample && (
          <fieldset className="mt-4 rounded-card border border-line bg-marble p-3">
            <legend className="px-1 text-base font-semibold text-ink">
              Отгрузка
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <Field
                id="f-plannedDate"
                type="date"
                label="Когда заберут"
                value={plannedDate}
                onChange={(ev) => setPlannedDate(ev.target.value)}
                error={e.plannedDate}
                hint="Необязательно"
              />
              <Field
                id="f-plannedTime"
                type="time"
                label="Время"
                value={plannedTime}
                onChange={(ev) => setPlannedTime(ev.target.value)}
                disabled={!plannedDate}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-sm">
              {(
                [
                  ["PICKUP", "Самовывоз"],
                  ["DELIVERY", "Доставка на объект"],
                ] as const
              ).map(([v, label]) => (
                <label key={v} className="flex min-h-11 cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="deliveryModeUi"
                    checked={deliveryMode === v}
                    onChange={() => setDeliveryMode(v)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {/* TZ9-A — блок «Оплата»: способ + цена + валюта; долг → срок/коммент. */}
        <fieldset className="mt-4 rounded-card border border-line bg-marble p-3">
          <legend className="px-1 text-base font-semibold text-ink">
            Оплата
          </legend>

          <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
            <Field
              id="f-price"
              label={
                <>
                  Цена продажи <span className="text-carnelian">*</span>
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
                Валюта <span className="text-carnelian">*</span>
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
                        "flex min-h-11 min-w-12 cursor-pointer items-center justify-center rounded-field border px-2 text-sm font-semibold transition-colors duration-150 " +
                        (selected
                          ? "border-honey bg-honey-soft text-ink"
                          : "border-line bg-marble text-ink-2")
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
          {/* ТЗ №20 H — ориентир владельца. Поле цены НЕ заполняем: цену
              менеджер вводит сам, ориентир — только подсказка. */}
          {stone?.priceHint && (
            <p className="mt-2 text-sm text-ink-2">
              Ориентир цены: <span className="tnum font-semibold text-ink">{stone.priceHint}</span>
            </p>
          )}

          {/* ТЗ №20 A — «Оплата сейчас»: несколько способов (50/50, 70/30),
              меньше цены → остаток уходит в долг, 0 → вся продажа в долг. */}
          <div className="mt-3 border-t border-line pt-3">
            <p className="mb-2 text-xs font-semibold text-honey-ink">
              Оплата сейчас
            </p>
            <div className="flex flex-col gap-2">
              {payRows.map((r, i) => (
                <div key={r.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                  <input
                    aria-label={`Сумма оплаты ${i + 1}`}
                    inputMode="decimal"
                    className={`${inputClass} tnum`}
                    placeholder="0"
                    value={r.auto ? (priceDisplay ? formatMoneyGrouped(priceDisplay) : "") : r.amount}
                    onChange={(ev) =>
                      setPayRows((rows) =>
                        rows.map((x) =>
                          x.id === r.id
                            ? { ...x, auto: false, amount: formatMoneyGrouped(ev.target.value) }
                            : x,
                        ),
                      )
                    }
                  />
                  <select
                    aria-label={`Способ оплаты ${i + 1}`}
                    className={inputClass}
                    value={r.method}
                    onChange={(ev) =>
                      setPayRows((rows) =>
                        rows.map((x) =>
                          x.id === r.id ? { ...x, method: ev.target.value as PayMethod } : x,
                        ),
                      )
                    }
                  >
                    {PAY_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {PAY_METHOD_LABEL[m]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label="Убрать строку оплаты"
                    className="min-h-11 min-w-11 rounded-field text-ink-3 hover:text-carnelian"
                    onClick={() =>
                      setPayRows((rows) =>
                        rows.length === 1
                          ? [{ ...rows[0], auto: false, amount: "" }]
                          : rows.filter((x) => x.id !== r.id),
                      )
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="mt-2 text-sm font-semibold text-honey-ink hover:underline"
              onClick={() =>
                setPayRows((rows) => [
                  // первая строка перестаёт «следовать за ценой» — дальше суммы ручные
                  ...rows.map((x) => (x.auto ? { ...x, auto: false, amount: formatMoneyGrouped(String(priceNum)) } : x)),
                  { id: payRowSeq.current++, amount: "", method: "CARD", auto: false },
                ])
              }
            >
              + Добавить способ оплаты
            </button>
            <p className={`tnum mt-2 text-sm ${overpaid ? "text-carnelian" : "text-ink"}`}>
              Оплачено: {formatMoneyGrouped(String(paidTotal))} {CURRENCY_LABEL[currency]} ·{" "}
              {overpaid
                ? "оплачено больше цены — исправьте суммы"
                : `Остаток в долг: ${formatMoneyGrouped(String(Math.max(0, debtLeft)))}`}
            </p>
            <FieldError msg={e.payments ?? e.paymentMethod} />
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

        <div className="mt-4 rounded-card border border-line bg-marble p-3">
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
                    Срок возврата образца <span className="text-carnelian">*</span>
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
              <p className="text-xs text-ink-2">
                Камень спишется со склада как «образец» и исчезнет из поиска.
              </p>
            </div>
          )}
        </div>

        <div className="sticky bottom-[calc(56px+env(safe-area-inset-bottom))] z-30 -mx-5 mt-4 border-t border-line bg-marble px-5 py-3 md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
        <Button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={
            issueAsSample
              ? !(
                  selectedClient &&
                  returnDueDateSample.trim() &&
                  !(isVolume && !qtySlabs.trim() && !qtyAreaM2.trim())
                )
              : !canProceed
          }
          className="w-full md:w-auto"
        >
          {issueAsSample ? "Далее — выдача образца" : "Далее — подтверждение"}
        </Button>
        </div>
      </Card>,
    );
  }

  // ── Шаг 4: подтверждение ──
  const fieldErrorItems = buildFieldErrorItems(e);

  return withSummary(
    <Card>
      <BackButton
        onClick={() => setConfirming(false)}
        label="Изменить данные"
      />
      <h2 className="mb-3 text-base font-semibold text-ink">
        {issueAsSample
          ? "4. Подтверждение выдачи образца"
          : "4. Подтверждение продажи"}
      </h2>

      {/* TZ14 BUG-01 + round2 leftover — sample failures never silent on step 4. */}
      {sampleErrorListUnique.length > 0 && (
        <Alert variant="danger" title="Образец не выдан" className="mb-4">
          {sampleErrorListUnique.length === 1 ? (
            <p className="text-base font-semibold">{sampleErrorListUnique[0]}</p>
          ) : (
            <ul className="list-disc space-y-1 pl-4 text-sm">
              {sampleErrorListUnique.map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-sm">
            Нажмите «Изменить данные», исправьте поля и подтвердите снова.
          </p>
        </Alert>
      )}

      {/* Domain conflict (INSUFFICIENT_REMAINDER, ALREADY_SOLD, …) — large, top. */}
      {!issueAsSample && state.conflict && (
        <Alert variant="danger" title="Продажа не прошла" className="mb-4">
          <p className="text-base font-semibold">{state.conflict}</p>
          <p className="mt-2 text-sm">
            Данные формы сохранены. Исправьте объём или наличие («Изменить
            данные») и подтвердите снова. При сомнении обновите страницу.
          </p>
        </Alert>
      )}

      {/* Field / form validation — MUST include qty* (salebug: silent reject). */}
      {!issueAsSample && fieldErrorItems.length > 0 && (
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

      <dl className="rounded-card border border-line bg-marble p-4 text-base">
        <div className="flex justify-between gap-3 py-1">
          <dt className="text-ink-2">Что</dt>
          <dd className="text-right font-semibold text-ink">{target.title}</dd>
        </div>
        <div className="flex justify-between gap-3 py-1">
          <dt className="text-ink-2">Детали</dt>
          <dd className="text-right text-sm text-ink-2">{target.subtitle}</dd>
        </div>
        {isVolume && qtyText && (
          <div className="flex justify-between gap-3 py-1">
            <dt className="text-ink-2">Объём</dt>
            <dd className="text-right font-semibold text-ink">{qtyText}</dd>
          </div>
        )}
        {isVolume && (target.locations?.length ?? 0) > 0 && (
          <div className="flex justify-between gap-3 py-1">
            <dt className="text-ink-2">Откуда</dt>
            <dd className="text-right text-sm text-ink">
              {(target.locations!.find((l) => l.id === batchLocationId) ??
                target.locations![0]).label}
            </dd>
          </div>
        )}
        {target.mode === "WHOLE_BATCH" && (
          <div className="flex justify-between gap-3 py-1">
            <dt className="text-ink-2">Объём</dt>
            <dd className="text-right font-semibold text-ink">весь свободный остаток</dd>
          </div>
        )}
        {consumedReservation && !issueAsSample && (
          <div className="flex justify-between gap-3 py-1">
            <dt className="text-ink-2">Закрыть бронь</dt>
            <dd className="text-right font-semibold text-ink">
              {consumedReservation.label}
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-3 py-1">
          <dt className="text-ink-2">Клиент</dt>
          <dd className="text-right font-semibold text-ink">
            {selectedClient ? selectedClient.name : "—"}
          </dd>
        </div>
        {selectedClient && (
          <div className="flex justify-between gap-3 py-1">
            <dt className="text-ink-2">Телефон</dt>
            <dd className="text-right text-ink">{selectedClient.phone}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3 py-1">
          <dt className="text-ink-2">Объект</dt>
          <dd className="text-right text-ink">
            {siteMode === "existing" && selectedSiteId
              ? (sites.find((s) => s.id === selectedSiteId)?.name ?? "—")
              : "Без объекта"}
          </dd>
        </div>
        <div className="flex justify-between gap-3 py-1">
          <dt className="text-ink-2">Оплата</dt>
          <dd className="text-right font-semibold text-ink">
            {payRowsResolved.filter((r) => r.amount > 0).length === 0
              ? "всё в долг"
              : payRowsResolved
                  .filter((r) => r.amount > 0)
                  .map((r) => `${formatMoneyGrouped(String(r.amount))} ${PAY_METHOD_LABEL[r.method]}`)
                  .join(" + ")}
            {isCredit && ` · в долг ${formatMoneyGrouped(String(debtLeft))}`}
          </dd>
        </div>
        <div className="flex justify-between gap-3 py-1">
          <dt className="text-ink-2">Цена</dt>
          <dd className="tnum text-right font-semibold text-ink">
            {priceDisplay.trim()
              ? formatMoneyGrouped(priceDisplay)
              : "—"}{" "}
            {CURRENCY_LABEL[currency]}
          </dd>
        </div>
        {(plannedDate || deliveryMode) && (
          <div className="flex justify-between gap-3 py-1">
            <dt className="text-ink-2">Заберут</dt>
            <dd className="text-right text-ink">
              {[
                plannedDate && `${plannedDate}${plannedTime ? `, ${plannedTime}` : ""}`,
                deliveryMode === "PICKUP" && "самовывоз",
                deliveryMode === "DELIVERY" && "доставка на объект",
              ]
                .filter(Boolean)
                .join(" · ")}
            </dd>
          </div>
        )}
        {isCredit && debtDueDate.trim() && (
          <div className="flex justify-between gap-3 py-1">
            <dt className="text-ink-2">Срок долга</dt>
            <dd className="text-right text-ink">{debtDueDate}</dd>
          </div>
        )}
        {isCredit && debtComment.trim() && (
          <div className="flex justify-between gap-3 py-1">
            <dt className="text-ink-2">Коммент. к долгу</dt>
            <dd className="text-right text-sm text-ink">{debtComment}</dd>
          </div>
        )}
        {issueAsSample && (
          <>
            <div className="flex justify-between gap-3 py-1">
              <dt className="text-ink-2">Тип</dt>
              <dd className="text-right font-semibold text-ink">Образец</dd>
            </div>
            <div className="flex justify-between gap-3 py-1">
              <dt className="text-ink-2">Срок возврата</dt>
              <dd className="text-right text-ink">
                {returnDueDateSample || "—"}
              </dd>
            </div>
          </>
        )}
      </dl>

      <form action={issueAsSample ? sampleAction : formAction}>
        <input type="hidden" name="mode" value={target.mode} />
        {leadPrefill && <input type="hidden" name="leadId" value={leadPrefill.leadId} />}
        {target.mode === "SLAB" || target.mode === "PIECE" ? (
          <input type="hidden" name="unitId" value={target.id} />
        ) : target.mode === "PATTERN_VOLUME" ? (
          <input type="hidden" name="batchPatternId" value={target.id} />
        ) : (
          <input type="hidden" name="batchId" value={target.id} />
        )}
        {isVolume && batchLocationId && (
          <input type="hidden" name="batchLocationId" value={batchLocationId} />
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
            <input type="hidden" name="payments" value={paymentsJson} />
            <input type="hidden" name="plannedDate" value={plannedDate} />
            <input type="hidden" name="plannedTime" value={plannedDate ? plannedTime : ""} />
            <input type="hidden" name="deliveryMode" value={deliveryMode} />
            <input type="hidden" name="currency" value={currency} />
            <input type="hidden" name="debtDueDate" value={debtDueDate} />
            <input type="hidden" name="debtComment" value={debtComment} />
            {isBatchSale && (
              <input
                type="hidden"
                name="consumeReservationId"
                value={consumeReservationId}
              />
            )}
          </>
        )}
        {isVolume && <input type="hidden" name="qtySlabs" value={qtySlabs} />}
        {isVolume && <input type="hidden" name="qtyAreaM2" value={qtyAreaM2} />}
        <div className="sticky bottom-[calc(56px+env(safe-area-inset-bottom))] z-30 -mx-5 mt-4 border-t border-line bg-marble px-5 py-3 md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
        <Button
          type="submit"
          pending={issueAsSample ? samplePending : pending}
          className="w-full md:w-auto"
        >
          {issueAsSample
            ? samplePending
              ? "Выдача…"
              : "Подтвердить выдачу образца"
            : pending
              ? "Оформление…"
              : "Подтвердить продажу"}
        </Button>
        </div>
      </form>
      <p className="mt-2 text-sm text-ink-2">
        {issueAsSample
          ? "После подтверждения образец появится в разделе «Образцы» (активные)."
          : "Камень списывается из наличия сразу в момент продажи (TZ §5.4). Способ оплаты на списание не влияет."}
      </p>
    </Card>,
  );
}
