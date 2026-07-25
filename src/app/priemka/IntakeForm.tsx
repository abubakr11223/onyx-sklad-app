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
  slabs: string;
  areaM2: string;
}
const emptyPat = (): PatValues => ({
  description: "",
  thicknessMm: "",
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
}: {
  stoneTypes: StoneTypeOption[];
  defaultDate: string;
  // ТЗ №6 §5.4 — сетка склада для подсказок блока/ориентира (datalist).
  blocks?: { letter: string; landmarks: string[] }[];
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
    slabsTotal: "",
    areaTotalM2: "",
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
  const DRAFT_KEY = "onyx-intake-draft-v1";
  const [offlineMsg, setOfflineMsg] = useState<string | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);

  // Сохраняем черновик при каждом изменении.
  useEffect(() => {
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ values, locs, rowIds, patternsEnabled, patRowIds, pats }),
      );
    } catch {
      /* localStorage может быть недоступен — не критично */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, locs, rowIds, patternsEnabled, patRowIds, pats]);

  // При монтировании: успех (?ok=1) → чистим черновик; иначе — восстанавливаем.
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get("ok") === "1") {
        localStorage.removeItem(DRAFT_KEY);
        return;
      }
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.values) setValues(d.values);
      if (d.locs) setLocs(d.locs);
      if (Array.isArray(d.rowIds) && d.rowIds.length) {
        setRowIds(d.rowIds);
        nextRowId.current = Math.max(...d.rowIds) + 1;
      }
      if (typeof d.patternsEnabled === "boolean") setPatternsEnabled(d.patternsEnabled);
      if (Array.isArray(d.patRowIds) && d.patRowIds.length) {
        setPatRowIds(d.patRowIds);
        nextPatId.current = Math.max(...d.patRowIds) + 1;
      }
      if (d.pats) setPats(d.pats);
      setDraftRestored(true);
    } catch {
      /* битый черновик — игнорируем */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setValues((v) => ({ ...v, [key]: ev.target.value }));
  const setLoc =
    (id: number, key: keyof LocValues) =>
    (ev: React.ChangeEvent<HTMLInputElement>) =>
      setLocs((m) => ({ ...m, [id]: { ...m[id], [key]: ev.target.value } }));

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
    slabsTotal: values.slabsTotal,
    areaTotalM2: values.areaTotalM2,
    supplierNote: values.supplierNote,
    arrivedAt: values.arrivedAt,
    locations: rowIds.map((id) => locs[id] ?? emptyLoc()),
    patternsEnabled,
    patterns: patternsEnabled ? patRowIds.map((id) => pats[id] ?? emptyPat()) : [],
  });

  // Первое проблемное поле (в порядке формы) → id DOM-элемента для фокуса.
  const firstErrorFieldId = (errs: IntakeErrors): string | null => {
    const simple = ["stoneTypeId", "newName", "newRockType", "slabsTotal", "areaTotalM2"];
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
      {e.form && <Alert variant="danger">{e.form}</Alert>}
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
      {/* ТЗ №6 §5.4 — справочник сетки склада для подсказок блока/ориентира. */}
      {blocks.length > 0 && (
        <>
          <datalist id="wh-blocks">
            {blocks.map((b) => (
              <option key={b.letter} value={b.letter} />
            ))}
          </datalist>
          {blocks.map((b) => (
            <datalist key={b.letter} id={`wh-lm-${b.letter}`}>
              {b.landmarks.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          ))}
        </>
      )}

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
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <Field
                      id={`patThickness-${idx}`}
                      name="patThickness"
                      inputMode="numeric"
                      label="Толщина, мм"
                      placeholder="20"
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
                  <Field
                    id={`locBlock-${idx}`}
                    name="locBlock"
                    label={<>Блок <Req /></>}
                    placeholder="А"
                    value={loc.block}
                    onChange={setLoc(id, "block")}
                    error={e[`loc-${idx}-block`]}
                    // ТЗ №6 §5.4 — подсказки из сетки склада (блоки).
                    list={blocks.length > 0 ? "wh-blocks" : undefined}
                  />
                  <Field
                    id={`locLandmark-${idx}`}
                    name="locLandmark"
                    label={<>Ориентир <Req /></>}
                    placeholder="2 или 1–2"
                    value={loc.landmark}
                    onChange={setLoc(id, "landmark")}
                    error={e[`loc-${idx}-landmark`]}
                    // Ориентиры выбранного блока (реактивно по loc.block).
                    list={
                      blocks.some((b) => b.letter === loc.block)
                        ? `wh-lm-${loc.block}`
                        : undefined
                    }
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
