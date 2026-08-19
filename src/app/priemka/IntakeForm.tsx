"use client";

// Форма приёмки партии (TZ §5.1, §6.3): партия целиком, без поимённых плит
// (ADR-004). Крупные touch-поля — складчик работает с телефона.
// C-pilot: разметка переведена на бренд-дизайн-систему (Button/Field/Card/Alert).
//
// BUG-01: поля КОНТРОЛИРУЕМЫЕ (value из state) — React 19 useActionState при
// возврате { errors } авто-сбрасывает только неконтролируемые input'ы; здесь
// значения живут в state и переживают ответ сервера. Валидация тем же чистым
// validateIntake прогоняется на КЛИЕНТЕ до отправки: невалидно ⇒ submit
// блокируется, ошибки показываются inline, фокус уходит на первое проблемное
// поле. Серверный submitIntake остаётся defense-in-depth (валидирует повторно
// и отдаёт ошибки уровня БД).

import { useActionState, useEffect, useRef, useState } from "react";
import { submitIntake, type IntakeFormState } from "./actions";
import {
  validateIntake,
  type IntakeErrors,
  type IntakeInput,
} from "@/lib/validators/intake";
import { parseMutationId } from "@/lib/intake-receipt";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field, { inputClass } from "@/components/ui/Field";
import Alert from "@/components/ui/Alert";
import { intakeErrorItems } from "./intake-form-errors";
import WarehouseLocationSelect from "@/components/WarehouseLocationSelect";
import { areaDiscrepancyPct, areaM2FromCm } from "@/lib/dimensions";
import { MAX_BATCH_PHOTOS } from "@/lib/photos";

/** W7-A2 — mint client mutationId (crypto.randomUUID when available). */
function newMutationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback (non-secure): still unique enough for de-dupe key shape.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export interface StoneTypeOption {
  id: string;
  name: string;
  rockType: string;
}

const initialState: IntakeFormState = { errors: {} };

/** Значения одной локации (контролируемые поля строки). */
interface LocValues {
  block: string;
  landmark: string;
  slabsHere: string;
  areaHereM2: string;
}
const emptyLoc = (): LocValues => ({
  block: "",
  landmark: "",
  slabsHere: "",
  areaHereM2: "",
});

/** ТЗ №3 — значения одной узор-подгруппы (контролируемые поля строки). */
interface PatValues {
  description: string;
  thicknessMm: string;
  lengthMm: string;
  widthMm: string;
  slabs: string;
  areaM2: string;
}
const emptyPat = (): PatValues => ({
  description: "",
  thicknessMm: "",
  lengthMm: "",
  widthMm: "",
  slabs: "",
  areaM2: "",
});

// Ошибка-ключ локации → id DOM-элемента строки (для перевода фокуса).
const LOC_FIELD_ID: Record<keyof LocValues, (i: number) => string> = {
  block: (i) => `locBlock-${i}`,
  landmark: (i) => `locLandmark-${i}`,
  slabsHere: (i) => `locSlabsHere-${i}`,
  areaHereM2: (i) => `locAreaHereM2-${i}`,
};

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
  blocks = [],
  canSeePrices = false,
}: {
  stoneTypes: StoneTypeOption[];
  defaultDate: string;
  // ТЗ №6 §5.4 — сетка склада для подсказок блока/ориентира (datalist).
  blocks?: { letter: string; landmarks: string[] }[];
  /**
   * W6-C: базовая цена на «Новом виде» — только canSeePrices (OWNER/MANAGER).
   * WAREHOUSE цен не видит (§3); сервер тоже игнорирует поле без этого флага.
   */
  canSeePrices?: boolean;
}) {
  const [state, formAction, pending] = useActionState(submitIntake, initialState);
  const [isNewType, setIsNewType] = useState(false);
  const [rowIds, setRowIds] = useState<number[]>([0]);
  const nextRowId = useRef(1);

  // ── Контролируемые значения формы (переживают авто-сброс React) ──
  const [values, setValues] = useState({
    stoneTypeId: "",
    newName: "",
    newRockType: "",
    newColor: "",
    newDescription: "",
    newBasePrice: "",
    slabsTotal: "",
    areaTotalM2: "",
    lengthMm: "",
    widthMm: "",
    thicknessMm: "",
    supplierNote: "",
    arrivedAt: defaultDate,
  });
  const [locs, setLocs] = useState<Record<number, LocValues>>({ 0: emptyLoc() });

  // ── ТЗ №3 — узоры в партии (подгруппы) ──
  const [patternsEnabled, setPatternsEnabled] = useState(false);
  const [patRowIds, setPatRowIds] = useState<number[]>([0]);
  const nextPatId = useRef(1);
  const [pats, setPats] = useState<Record<number, PatValues>>({ 0: emptyPat() });

  // Ошибки клиентской валидации; null = клиент не блокировал, показываем серверные.
  const [clientErrors, setClientErrors] = useState<IntakeErrors | null>(null);
  const e = clientErrors ?? state.errors;

  // §7/§8 — офлайн-черновик: приёмка не теряется при слабой связи. Значения
  // формы сохраняются в localStorage; при обрыве связи submit не уходит (данные
  // остаются черновиком), при возврате на страницу — восстанавливаются.
  //
  // W7-A2 mutationId rotation rule:
  //  • Mint once per logical intake (restore from draft if present).
  //  • KEEP across validation errors, offline block, online auto-resubmit.
  //  • ROTATE only when starting a new logical intake: success (?ok=1 clears
  //    draft + new id) or explicit clearDraft (full reload).
  // Rotating on every submit would defeat de-dupe; never rotating would make
  // two real intakes share one id after success.
  const DRAFT_KEY = "onyx-intake-draft-v1";
  const [offlineMsg, setOfflineMsg] = useState<string | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  // Mint once per mount; restore may overwrite. Not in save-effect deps —
  // otherwise empty mount would write a draft (breaks hydrated-gate tests).
  const [mutationId, setMutationId] = useState(newMutationId);
  // BUG-08 + W2-B-FIX: gate — useRef (state emas!).
  // Sabab: setHydrated(true) save effect deps orqali qayta ishga tushib
  // ?ok=1 / bo'sh tashrifda default formani draft qilib QAYTA yozardi.
  // Ref flip re-render bermaydi → save faqat values o'zgaganda (restore
  // setState yoki user input) yozadi. Eski pre-W2-B xulq.
  // setState effect body da SINXRON emas → queueMicrotask (set-state-in-effect).
  const draftReady = useRef(false);

  // Сохраняем черновик при каждом изменении (но не раньше restore gate).
  // mutationId is bundled into the payload but NOT a dep: rotating id alone
  // must not create an empty draft (W2-B-FIX gate).
  useEffect(() => {
    if (!draftReady.current) return;
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          values,
          locs,
          rowIds,
          patternsEnabled,
          patRowIds,
          pats,
          mutationId,
        }),
      );
    } catch {
      /* localStorage может быть недоступен — не критично */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutationId intentionally omitted (see comment above)
  }, [values, locs, rowIds, patternsEnabled, patRowIds, pats]);

  // При монтировании: успех (?ok=1) → чистим черновик; иначе — восстанавливаем.
  // Microtask: setState sync effect emas. finally: draftReady=true (ref).
  // - restore: setStates → re-render → save tiklangan qiymatni yozadi
  // - ok=1 / no-draft: form values unchanged → save effect does not re-fire
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const sp = new URLSearchParams(window.location.search);
        if (sp.get("ok") === "1") {
          localStorage.removeItem(DRAFT_KEY);
          // New logical intake after success — mint fresh id (values unchanged
          // so save effect will not write an empty draft).
          if (!cancelled) setMutationId(newMutationId());
          return;
        }
        const raw = localStorage.getItem(DRAFT_KEY);
        if (!raw) return;
        const d = JSON.parse(raw) as {
          values?: typeof values;
          locs?: typeof locs;
          rowIds?: number[];
          patternsEnabled?: boolean;
          patRowIds?: number[];
          pats?: typeof pats;
          mutationId?: string;
        };
        if (d.values) setValues(d.values);
        if (d.locs) setLocs(d.locs);
        if (Array.isArray(d.rowIds) && d.rowIds.length) {
          setRowIds(d.rowIds);
          nextRowId.current = Math.max(...d.rowIds) + 1;
        }
        if (typeof d.patternsEnabled === "boolean") {
          setPatternsEnabled(d.patternsEnabled);
        }
        if (Array.isArray(d.patRowIds) && d.patRowIds.length) {
          setPatRowIds(d.patRowIds);
          nextPatId.current = Math.max(...d.patRowIds) + 1;
        }
        if (d.pats) setPats(d.pats);
        const restoredId = parseMutationId(d.mutationId ?? null);
        if (restoredId) setMutationId(restoredId);
        setDraftRestored(true);
      } catch {
        /* битый черновик — игнорируем */
      } finally {
        // Ref — re-render yo'q. Save effect faqat values o'zgaganda ishlaydi.
        if (!cancelled) draftReady.current = true;
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const clearDraft = () => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* noop */
    }
    setDraftRestored(false);
    window.location.href = "/priemka";
  };

  // §7/§8 — связь появилась, а был отложенный офлайн-submit → отправляем сами.
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const onOnline = () => {
      if (offlineMsg) {
        setOfflineMsg(null);
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [offlineMsg]);

  const setField =
    (key: keyof typeof values) =>
    (
      ev: React.ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >,
    ) =>
      setValues((v) => ({ ...v, [key]: ev.target.value }));
  const setLoc =
    (id: number, key: keyof LocValues) =>
    (ev: React.ChangeEvent<HTMLInputElement>) =>
      setLocs((m) => ({ ...m, [id]: { ...m[id], [key]: ev.target.value } }));

  /** ТЗ №17 §6 — то же, но значением (селекты локации отдают строку). */
  const setLocValue = (id: number, key: keyof LocValues) => (value: string) =>
    setLocs((m) => ({ ...m, [id]: { ...m[id], [key]: value } }));

  /**
   * Смена блока обнуляет ориентир: «ориентир 5» в блоке A1 и в B2 — разные
   * места, и оставленный номер молча записал бы камень не туда.
   */
  const setLocBlock = (id: number) => (value: string) =>
    setLocs((m) => ({ ...m, [id]: { ...m[id], block: value, landmark: "" } }));

  const addRow = () => {
    const id = nextRowId.current++;
    setRowIds((ids) => [...ids, id]);
    setLocs((m) => ({ ...m, [id]: emptyLoc() }));
  };
  const removeRow = (id: number) => {
    // Последнюю строку не удаляем; locs чистим только когда строка реально ушла.
    if (rowIds.length <= 1) return;
    setRowIds((ids) => ids.filter((x) => x !== id));
    setLocs((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
  };

  // ── Узор-подгруппы: контроль строк (как локации) ──
  const setPat =
    (id: number, key: keyof PatValues) =>
    (ev: React.ChangeEvent<HTMLInputElement>) =>
      setPats((m) => ({ ...m, [id]: { ...m[id], [key]: ev.target.value } }));
  const addPat = () => {
    const id = nextPatId.current++;
    setPatRowIds((ids) => [...ids, id]);
    setPats((m) => ({ ...m, [id]: emptyPat() }));
  };
  const removePat = (id: number) => {
    if (patRowIds.length <= 1) return;
    setPatRowIds((ids) => ids.filter((x) => x !== id));
    setPats((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
  };

  // Живой ИТОГО по узорам (подсказка; строгая проверка — в validateIntake).
  const patTotals = patRowIds.reduce(
    (acc, id) => {
      const p = pats[id] ?? emptyPat();
      const s = Number.parseInt(p.slabs, 10);
      const a = Number.parseFloat(p.areaM2.replace(",", "."));
      return {
        slabs: acc.slabs + (Number.isFinite(s) ? s : 0),
        area: acc.area + (Number.isFinite(a) ? a : 0),
      };
    },
    { slabs: 0, area: 0 },
  );

  // Собираем вход валидатора из контролируемого state (порядок локаций = rowIds).
  const buildInput = (): IntakeInput => ({
    stoneTypeId: values.stoneTypeId,
    newStoneType: isNewType,
    newName: values.newName,
    newRockType: values.newRockType,
    newColor: values.newColor,
    newDescription: values.newDescription,
    // Без canSeePrices поле в UI нет — шлём пусто (сервер всё равно гейтит).
    newBasePrice: canSeePrices ? values.newBasePrice : "",
    slabsTotal: values.slabsTotal,
    areaTotalM2: values.areaTotalM2,
    lengthMm: values.lengthMm,
    widthMm: values.widthMm,
    thicknessMm: values.thicknessMm,
    supplierNote: values.supplierNote,
    arrivedAt: values.arrivedAt,
    locations: rowIds.map((id) => locs[id] ?? emptyLoc()),
    patternsEnabled,
    patterns: patternsEnabled ? patRowIds.map((id) => pats[id] ?? emptyPat()) : [],
  });

  // Первое проблемное поле (в порядке формы) → id DOM-элемента для фокуса.
  const firstErrorFieldId = (errs: IntakeErrors): string | null => {
    const simple = [
      "stoneTypeId",
      "newName",
      "newRockType",
      "newDescription",
      "newBasePrice",
      "slabsTotal",
      "lengthMm",
      "widthMm",
      "thicknessMm",
      "areaTotalM2",
    ];
    for (const k of simple) if (errs[k]) return k;
    if (errs.quantity) return "slabsTotal";
    for (let i = 0; i < rowIds.length; i++) {
      for (const s of ["block", "landmark", "slabsHere", "areaHereM2"] as const) {
        if (errs[`loc-${i}-${s}`]) return LOC_FIELD_ID[s](i);
      }
    }
    // ТЗ №3 — узоры.
    if (errs.patternsTotals || errs.patterns || errs.patternsSum) return "slabsTotal";
    for (let i = 0; i < patRowIds.length; i++) {
      if (errs[`pattern-${i}-description`]) return `patDescription-${i}`;
      // sweep: length/width focus was missed — errors under field but no auto-focus
      if (errs[`pattern-${i}-length`]) return `patLength-${i}`;
      if (errs[`pattern-${i}-width`]) return `patWidth-${i}`;
      if (errs[`pattern-${i}-thickness`]) return `patThickness-${i}`;
      if (errs[`pattern-${i}-slabs`]) return `patSlabs-${i}`;
      if (errs[`pattern-${i}-area`]) return `patArea-${i}`;
    }
    if (errs.arrivedAt) return "arrivedAt";
    return null;
  };

  const focusFirstError = (errs: IntakeErrors) => {
    const id = firstErrorFieldId(errs);
    if (!id) return;
    // Field не пробрасывает ref (общий компонент — вне зоны правки), поэтому
    // фокусируемся по стабильному id элемента. Реальный DOM-фокус перемещается.
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  };

  // BUG-01: клиентская валидация ДО отправки. Невалидно ⇒ preventDefault
  // (server action не диспатчится), показываем ошибки, ведём фокус. Валидно ⇒
  // не мешаем — форма уходит через action={formAction} (server action).
  const handleSubmit = (ev: React.FormEvent<HTMLFormElement>) => {
    const result = validateIntake(buildInput());
    if (!result.ok) {
      ev.preventDefault();
      setClientErrors(result.errors);
      focusFirstError(result.errors);
      return;
    }
    setClientErrors(null);
    // §7/§8 — офлайн: НЕ отправляем (server action всё равно не дойдёт). Данные
    // уже в черновике (localStorage) — не теряются. Отправьте при связи.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      ev.preventDefault();
      setOfflineMsg(
        "Нет связи — данные сохранены как черновик. Нажмите «Принять партию» ещё раз, когда связь появится.",
      );
      return;
    }
    setOfflineMsg(null);
  };

  // Ошибки уровня БД возвращает сервер через state — тоже показываем и фокусируем.
  useEffect(() => {
    if (clientErrors === null && Object.keys(state.errors).length > 0) {
      focusFirstError(state.errors);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={handleSubmit}
      className="flex flex-col gap-6"
    >
      {/* W7-A2 — same logical intake → same mutationId (de-dupe on server). */}
      <input type="hidden" name="mutationId" value={mutationId} />
      {(() => {
        // Preferred top keys + any leftover (unknown / dynamic not in TOP list
        // still append via orderedErrorMessages). form always listed first.
        const banner = intakeErrorItems(e);
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
      {/* §7/§8 — офлайн: данные сохранены черновиком, не потеряны. */}
      {offlineMsg && <Alert variant="warning">{offlineMsg}</Alert>}
      {draftRestored && (
        <Alert variant="success">
          Восстановлен незаконченный черновик приёмки.{" "}
          <button
            type="button"
            onClick={clearDraft}
            className="font-semibold underline"
          >
            Очистить и начать заново
          </button>
        </Alert>
      )}
      {/* ТЗ №17 §6 — datalist сетки склада больше не нужен: блок и ориентир
          выбираются селектами (см. WarehouseLocationSelect ниже). */}

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
              value={values.newName}
              onChange={setField("newName")}
              error={e.newName}
            />
            <Field
              id="newRockType"
              name="newRockType"
              label={<>Порода <Req /></>}
              placeholder="мрамор, гранит, оникс…"
              value={values.newRockType}
              onChange={setField("newRockType")}
              error={e.newRockType}
            />
            <Field
              id="newColor"
              name="newColor"
              label="Цвет"
              placeholder="бежевый"
              value={values.newColor}
              onChange={setField("newColor")}
            />
            {/* W6-C / §5.1 — описание опционально: QR/шоу-рум не пустые, приёмка
                не блокируется. Текстовая область — как на /kamen. */}
            <Field
              id="newDescription"
              label="Описание"
              hint="Необязательно. Коротко для каталога и QR-карточки."
              error={e.newDescription}
            >
              <textarea
                id="newDescription"
                name="newDescription"
                rows={3}
                value={values.newDescription}
                onChange={setField("newDescription")}
                placeholder="Светлый травертин, мягкий рисунок…"
                className={inputClass + " min-h-[5.5rem] py-2"}
                aria-invalid={e.newDescription ? true : undefined}
              />
            </Field>
            {canSeePrices && (
              <Field
                id="newBasePrice"
                name="newBasePrice"
                label="Базовая цена, $/м²"
                placeholder="например 95"
                inputMode="decimal"
                value={values.newBasePrice}
                onChange={setField("newBasePrice")}
                error={e.newBasePrice}
                hint="Необязательно. Закупочную цену на приёмке не спрашиваем."
              />
            )}
          </div>
        ) : (
          <Field id="stoneTypeId" label={<>Вид <Req /></>} error={e.stoneTypeId}>
            <select
              id="stoneTypeId"
              name="stoneTypeId"
              value={values.stoneTypeId}
              onChange={setField("stoneTypeId")}
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
            value={values.slabsTotal}
            onChange={setField("slabsTotal")}
            error={e.slabsTotal}
          />
          <Field
            id="areaTotalM2"
            name="areaTotalM2"
            inputMode="decimal"
            label="Площадь, м²"
            placeholder="220 или 12,5"
            value={values.areaTotalM2}
            onChange={setField("areaTotalM2")}
            error={e.areaTotalM2}
          />
        </div>
        <div className="mt-1.5">
          <CrossError msg={e.quantity} />
        </div>
      </Card>

      {/* ── ТЗ №12: размер плиты (см) ── */}
      {!patternsEnabled && (
        <Card>
          <h2 className="mb-1 text-lg font-semibold text-ink">
            Размер плиты <span className="text-danger">*</span>
          </h2>
          <p className="mb-4 text-sm text-ink/60">
            Длина и ширина обязательны (см). Без них партию не принять — по
            габариту ищут целые плиты.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <Field
              id="lengthMm"
              name="lengthMm"
              inputMode="numeric"
              label={<>Длина, см <Req /></>}
              placeholder="280"
              value={values.lengthMm}
              onChange={setField("lengthMm")}
              error={e.lengthMm}
            />
            <Field
              id="widthMm"
              name="widthMm"
              inputMode="numeric"
              label={<>Ширина, см <Req /></>}
              placeholder="160"
              value={values.widthMm}
              onChange={setField("widthMm")}
              error={e.widthMm}
            />
            <Field
              id="thicknessMm"
              name="thicknessMm"
              inputMode="decimal"
              label="Толщина, см"
              placeholder="2 или 1,8"
              value={values.thicknessMm}
              onChange={setField("thicknessMm")}
              error={e.thicknessMm}
            />
          </div>
          {(() => {
            const L = Number.parseInt(values.lengthMm, 10);
            const W = Number.parseInt(values.widthMm, 10);
            const N = Number.parseInt(values.slabsTotal, 10);
            const A = Number.parseFloat(values.areaTotalM2.replace(",", "."));
            if (!(L > 0 && W > 0 && N > 0 && A > 0)) return null;
            const expected = areaM2FromCm(L, W) * N;
            const pct = areaDiscrepancyPct(L, W, N, A);
            if (pct == null) return null;
            const soft = pct >= 10;
            return (
              <p
                className={
                  "mt-3 text-sm " +
                  (soft ? "font-medium text-warning" : "text-ink/55")
                }
              >
                По размеру: {L}×{W} см × {N} ≈ {expected.toFixed(1)} м²
                (введено {A} м²
                {soft
                  ? ` — расхождение ~${pct.toFixed(0)}%, проверьте ввод`
                  : ""}
                ).
              </p>
            );
          })()}
        </Card>
      )}

      {/* ── Узоры в партии (ТЗ №3) ── */}
      <Card>
        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={patternsEnabled}
            onChange={(ev) => setPatternsEnabled(ev.target.checked)}
            className="h-4 w-4 accent-gold"
          />
          <span className="text-lg font-semibold text-ink">
            В партии несколько узоров / толщин
          </span>
        </label>

        {!patternsEnabled ? (
          <p className="mt-2 text-sm text-ink/55">
            Однородная партия — оставьте выключенным (быстрый путь). Если узоров
            несколько — отметьте, заполните таблицу; фото каждого узора запросим у
            складчика в Telegram.
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            <input type="hidden" name="patternsEnabled" value="1" />
            {/* BUG-02 (ТЗ №4): фото узора не грузится здесь — после приёмки
                система САМА отправит складчику фотозапрос по каждому узору в
                Telegram, и фото привяжется к подгруппе (см. карточку камня). */}
            <p className="rounded-card bg-gold/8 px-3 py-2 text-sm text-ink/70">
              📷 Фото узоров грузить здесь не нужно: после приёмки система
              автоматически запросит у складчика фото каждого узора в Telegram —
              оно привяжется к подгруппе.
            </p>
            <CrossError msg={e.patternsTotals} />
            <CrossError msg={e.patterns} />

            {patRowIds.map((id, idx) => {
              const p = pats[id] ?? emptyPat();
              return (
                <div key={id} className="rounded-card border border-line bg-paper p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-base font-semibold text-ink">Узор {idx + 1}</span>
                    {patRowIds.length > 1 && (
                      <Button variant="ghost" size="sm" onClick={() => removePat(id)}>
                        Убрать
                      </Button>
                    )}
                  </div>
                  <Field
                    id={`patDescription-${idx}`}
                    name="patDescription"
                    label={<>Описание узора <Req /></>}
                    placeholder="светлый с прожилками"
                    value={p.description}
                    onChange={setPat(id, "description")}
                    error={e[`pattern-${idx}-description`]}
                  />
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <Field
                      id={`patLength-${idx}`}
                      name="patLength"
                      inputMode="numeric"
                      label={<>Длина, см <Req /></>}
                      placeholder="280"
                      value={p.lengthMm}
                      onChange={setPat(id, "lengthMm")}
                      error={e[`pattern-${idx}-length`]}
                    />
                    <Field
                      id={`patWidth-${idx}`}
                      name="patWidth"
                      inputMode="numeric"
                      label={<>Ширина, см <Req /></>}
                      placeholder="160"
                      value={p.widthMm}
                      onChange={setPat(id, "widthMm")}
                      error={e[`pattern-${idx}-width`]}
                    />
                    <Field
                      id={`patThickness-${idx}`}
                      name="patThickness"
                      inputMode="decimal"
                      label="Толщина, см"
                      placeholder="2 или 1,8"
                      value={p.thicknessMm}
                      onChange={setPat(id, "thicknessMm")}
                      error={e[`pattern-${idx}-thickness`]}
                    />
                    <Field
                      id={`patSlabs-${idx}`}
                      name="patSlabs"
                      inputMode="numeric"
                      label={<>Плит <Req /></>}
                      placeholder="50"
                      value={p.slabs}
                      onChange={setPat(id, "slabs")}
                      error={e[`pattern-${idx}-slabs`]}
                    />
                    <Field
                      id={`patArea-${idx}`}
                      name="patArea"
                      inputMode="decimal"
                      label={<>м² <Req /></>}
                      placeholder="30"
                      value={p.areaM2}
                      onChange={setPat(id, "areaM2")}
                      error={e[`pattern-${idx}-area`]}
                    />
                  </div>

                  {/* ТЗ №7 §3 (BUG-02) — фото узора прямо в приёмке: менеджер
                      покажет готовое фото B2C-клиенту без нового фотозапроса.
                      Необязательно: без фото узор уйдёт в Telegram-фотозапрос. */}
                  <div className="mt-3 flex flex-col gap-1.5">
                    <label
                      htmlFor={`patPhoto-${idx}`}
                      className="text-sm font-semibold text-ink"
                    >
                      Фото узора
                    </label>
                    <input
                      id={`patPhoto-${idx}`}
                      name="patPhoto"
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="block w-full text-sm text-ink/70 file:mr-3 file:rounded-field file:border-0 file:bg-gold/15 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-gold-deep hover:file:bg-gold/25"
                    />
                    <p className="text-xs text-ink/50">
                      Снимок подгруппы — по нему узор покажут клиенту. Можно
                      пропустить: тогда придёт фотозапрос в Telegram.
                    </p>
                  </div>
                </div>
              );
            })}

            <Button variant="secondary" size="sm" onClick={addPat} className="self-start">
              + Добавить узор
            </Button>

            {/* BUG-03 (ТЗ №4): живой ИТОГО + цель партии + подсветка расхождения
                ПРЯМО в форме (до сохранения), а не только на «Принять партию». */}
            {(() => {
              const tgtSlabs = Number.parseInt(values.slabsTotal, 10);
              const tgtArea = Number.parseFloat(
                values.areaTotalM2.replace(",", "."),
              );
              const hasSlabsTgt = Number.isFinite(tgtSlabs);
              const hasAreaTgt = Number.isFinite(tgtArea);
              const slabsOk = !hasSlabsTgt || patTotals.slabs === tgtSlabs;
              const areaOk =
                !hasAreaTgt || Math.abs(patTotals.area - tgtArea) < 0.001;
              const converged = slabsOk && areaOk && (hasSlabsTgt || hasAreaTgt);
              return (
                <div
                  className={`rounded-card px-3 py-2 text-sm ${
                    converged
                      ? "bg-success/10"
                      : hasSlabsTgt || hasAreaTgt
                        ? "bg-warning/12"
                        : "bg-ink/[0.03]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-ink">ИТОГО по узорам</span>
                    <span className="tnum text-ink/70">
                      {patTotals.slabs} плит · {patTotals.area.toFixed(1)} м²
                    </span>
                  </div>
                  {(hasSlabsTgt || hasAreaTgt) && (
                    <div className="mt-1 flex items-center justify-between">
                      <span className="text-ink/50">Партия (цель)</span>
                      <span className="tnum text-ink/50">
                        {hasSlabsTgt ? tgtSlabs : "—"} плит ·{" "}
                        {hasAreaTgt ? tgtArea.toFixed(1) : "—"} м²
                      </span>
                    </div>
                  )}
                  {(hasSlabsTgt || hasAreaTgt) && (
                    <p
                      className={`mt-1 font-medium ${
                        converged ? "text-success" : "text-warning"
                      }`}
                    >
                      {converged
                        ? "✓ сходится с партией"
                        : "не сходится — сумма узоров должна равняться партии"}
                    </p>
                  )}
                </div>
              );
            })()}
            <CrossError msg={e.patternsSum} />
          </div>
        )}
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
          {rowIds.map((id, idx) => {
            const loc = locs[id] ?? emptyLoc();
            return (
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
                  {/* ТЗ №17 §6 — блок и ориентир выбираются из карты склада.
                      Свободный ввод убран: он плодил дубли справочника. */}
                  <WarehouseLocationSelect
                    blocks={blocks}
                    index={idx}
                    block={loc.block}
                    landmark={loc.landmark}
                    onBlockChange={setLocBlock(id)}
                    onLandmarkChange={setLocValue(id, "landmark")}
                    blockError={e[`loc-${idx}-block`]}
                    landmarkError={e[`loc-${idx}-landmark`]}
                  />
                  <Field
                    id={`locSlabsHere-${idx}`}
                    name="locSlabsHere"
                    inputMode="numeric"
                    label="Плит здесь"
                    placeholder="25"
                    value={loc.slabsHere}
                    onChange={setLoc(id, "slabsHere")}
                    error={e[`loc-${idx}-slabsHere`]}
                  />
                  <Field
                    id={`locAreaHereM2-${idx}`}
                    name="locAreaHereM2"
                    inputMode="decimal"
                    label="м² здесь"
                    placeholder="137,5"
                    value={loc.areaHereM2}
                    onChange={setLoc(id, "areaHereM2")}
                    error={e[`loc-${idx}-areaHereM2`]}
                  />
                </div>
              </div>
            );
          })}
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
            value={values.arrivedAt}
            onChange={setField("arrivedAt")}
            label="Дата прихода"
            error={e.arrivedAt}
          />
          <Field
            id="supplierNote"
            name="supplierNote"
            label="Поставщик / документ"
            placeholder="Инвойс TR-118, контейнер…"
            value={values.supplierNote}
            onChange={setField("supplierNote")}
          />

          {/* ТЗ №16 B — общее фото партии. Фото узора (в подгруппах) остаётся:
              узор — конкретный рисунок для B2C, партия — как поставка пришла
              (паллета, контейнер, состояние). Однородная партия без узоров
              раньше вообще не имела фото — камень был «слепой». */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="batchPhoto"
              className="text-sm font-semibold text-ink"
            >
              Фото партии
            </label>
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
              Общий вид поставки — как камень пришёл. До {MAX_BATCH_PHOTOS} фото.
              Необязательно, но помогает при споре с поставщиком.
            </p>
          </div>
        </div>
      </Card>

      {/* Липкая нижняя панель отправки — большой палец достаёт CTA на мобиле;
          на десктопе (md:) возвращается в обычный поток. Реальный submit
          формы (action={formAction}) сохраняется — устойчивость к слабой сети. */}
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
