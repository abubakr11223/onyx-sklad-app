"use client";

// Форма «Разбить камень» (TZ §5.6, §6.4) — складчик с телефона:
// крупные поля, минимум текста, шаг подтверждения перед записью.
// C-batch: разметка переведена на бренд-дизайн-систему (Button/Field/Card/Alert).
// Поведение, имена полей, порядок строк и контракт валидации НЕ менялись.

import {
  useActionState,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { submitBreak, type BreakFormState } from "./actions";
import {
  breakLeftoverItems,
  breakRenderedKeys,
} from "./break-form-errors";
import { BREAK_CAUSES } from "@/lib/breaking";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field, { inputClass } from "@/components/ui/Field";
import Alert from "@/components/ui/Alert";
import WarehouseGridDatalists from "@/components/WarehouseGridDatalists";
import { areaM2FromCm, formatGabarit } from "@/lib/dimensions";
import { formatLocation } from "@/lib/locations";
import WarehouseLocationSelect from "@/components/WarehouseLocationSelect";

export interface SlabOption {
  id: string;
  label: string;
  stoneName: string;
  reserved: boolean;
  block: string;
  landmark: string;
  lengthMm?: number | null;
  widthMm?: number | null;
  thicknessMm?: number | null;
  areaM2?: number | null;
  photoId?: string | null;
}

export interface BatchOption {
  id: string;
  stoneName: string;
  arrived: string; // уже отформатированная дата
  qty: string; // «40 плит / 220 м²»
}

/** ТЗ №7 §2 — блок из сетки склада для datalist-подсказки. */
export interface BlockOption {
  letter: string;
  landmarks: string[];
}

const initialState: BreakFormState = { errors: {} };

/** Значения одной строки-куска (CRIT-02: controlled, чтобы не слетали при ошибке). */
interface PieceVals {
  kind: string;
  sides: string;
  len: string;
  width: string;
  thickness: string;
  area: string;
  block: string;
  landmark: string;
  /** false → show «Стороны» (непрямоугольный). */
  isRect: boolean;
}
const emptyPiece = (): PieceVals => ({
  kind: "BROKEN",
  sides: "",
  len: "",
  width: "",
  thickness: "",
  area: "",
  block: "",
  landmark: "",
  isRect: true,
});

/** Звёздочка «обязательное поле». */
function Req() {
  return <span className="text-danger">*</span>;
}

/** Кросс-полевая ошибка (не привязана к одному input — напр. pieces). */
function CrossError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="text-sm font-medium text-danger">{msg}</p>;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = map.get(k);
    if (group) group.push(item);
    else map.set(k, [item]);
  }
  return map;
}

export default function BreakForm({
  slabs,
  batches,
  blocks = [],
}: {
  slabs: SlabOption[];
  batches: BatchOption[];
  blocks?: BlockOption[];
}) {
  const [state, formAction, pending] = useActionState(submitBreak, initialState);
  const [mode, setMode] = useState<"slab" | "direct">("slab");
  const [soldPart, setSoldPart] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [rowIds, setRowIds] = useState<number[]>([0]);
  const nextRowId = useRef(1);
  const e = state.errors;

  // CRIT-02 (ТЗ №4): все поля CONTROLLED (значения в state) — при ошибке
  // валидации данные НЕ слетают (как в IntakeForm, паттерн ТЗ №2 BUG-01).
  const [batchId, setBatchId] = useState("");
  const [slabId, setSlabId] = useState("");
  const [breakCause, setBreakCause] = useState("");
  const [rows, setRows] = useState<Record<number, PieceVals>>({
    0: emptyPiece(),
  });
  const setPiece =
    (id: number, key: keyof PieceVals) =>
    (ev: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setRows((m) => {
        const prev = { ...(m[id] ?? emptyPiece()), [key]: ev.target.value };
        // ТЗ №13 §5.5: прямоугольник → площадь из L×W (см → м²), read-only.
        if (prev.isRect && (key === "len" || key === "width")) {
          const L = Number(prev.len.replace(",", "."));
          const W = Number(prev.width.replace(",", "."));
          if (Number.isFinite(L) && L > 0 && Number.isFinite(W) && W > 0) {
            prev.area = areaM2FromCm(L, W).toFixed(3).replace(".", ",");
          }
        }
        return { ...m, [id]: prev };
      });
  /** ТЗ №17 §6 — селекты локации отдают значение, а не событие. */
  const setPieceValue = (id: number, key: keyof PieceVals) => (value: string) =>
    setRows((m) => ({ ...m, [id]: { ...(m[id] ?? emptyPiece()), [key]: value } }));

  /** Смена блока обнуляет ориентир: тот же номер в другом блоке — другое место. */
  const setPieceBlock = (id: number) => (value: string) =>
    setRows((m) => ({
      ...m,
      [id]: { ...(m[id] ?? emptyPiece()), block: value, landmark: "" },
    }));

  const setPieceRect = (id: number, isRect: boolean) =>
    setRows((m) => {
      const prev = { ...(m[id] ?? emptyPiece()), isRect };
      if (isRect) {
        prev.sides = "";
        const L = Number(prev.len.replace(",", "."));
        const W = Number(prev.width.replace(",", "."));
        if (Number.isFinite(L) && L > 0 && Number.isFinite(W) && W > 0) {
          prev.area = areaM2FromCm(L, W).toFixed(3).replace(".", ",");
        }
      }
      return { ...m, [id]: prev };
    });
  const selectedSlab = slabs.find((s) => s.id === slabId) ?? null;

  // CRIT-01 (ТЗ №4): при ошибке валидации ВЫХОДИМ из шага подтверждения, чтобы
  // ошибки полей стали видны (иначе submit «молча не проходит» — ошибки висят на
  // скрытых сверху полях, а форма застряла на «Подтвердить»).
  // Pattern: React "adjusting state when props/state change" — render paytida
  // oldingi state bilan solishtirib setState (effect emas, cascading emas).
  const [prevActionState, setPrevActionState] = useState(state);
  if (state !== prevActionState) {
    setPrevActionState(state);
    if (Object.keys(state.errors).length > 0) {
      setConfirming(false);
    }
  }

  const addRow = () => {
    const id = nextRowId.current++;
    setRowIds((ids) => [...ids, id]);
    setRows((m) => ({ ...m, [id]: emptyPiece() }));
  };
  const removeRow = (id: number) =>
    setRowIds((ids) => (ids.length > 1 ? ids.filter((x) => x !== id) : ids));

  const slabGroups = groupBy(slabs, (s) => s.stoneName);
  const batchGroups = groupBy(batches, (b) => b.stoneName);

  // soldPart edge + unknown keys: anything not on a mounted Field → banner.
  const leftovers = breakLeftoverItems(
    e,
    breakRenderedKeys({
      mode,
      soldPart,
      pieceRowCount: rowIds.length,
    }),
  );
  // form is always in banner when ensureFormError set it (or domain form).
  const topMessages = [
    ...new Set([...(e.form ? [e.form] : []), ...leftovers]),
  ];

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {topMessages.length > 0 && (
        <Alert variant="danger" title="Проверьте данные">
          {topMessages.length === 1 ? (
            <p className="text-base font-semibold">{topMessages[0]}</p>
          ) : (
            <ul className="list-disc space-y-1 pl-4 text-sm">
              {topMessages.map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}
      <input type="hidden" name="mode" value={mode} />

      {/* ТЗ №7 §2 / #14 — общий компонент datalist сетки склада. */}
      <WarehouseGridDatalists blocks={blocks} />

      {/* ── Что разбиваем ── */}
      <Card>
        <h2 className="mb-3 text-lg font-semibold text-ink">Что разбиваем</h2>
        <div className="mb-2 flex gap-2">
          <Button
            variant={mode === "slab" ? "primary" : "secondary"}
            onClick={() => setMode("slab")}
            className="flex-1"
          >
            Плита
          </Button>
          <Button
            variant={mode === "direct" ? "primary" : "secondary"}
            onClick={() => setMode("direct")}
            className="flex-1"
          >
            Бой в партии
          </Button>
        </div>
        <p className="mb-4 text-sm text-ink/60">
          {mode === "slab"
            ? "Плита — разбить конкретную выделенную плиту (была выбрана под клиента)."
            : "Бой в партии — разбить/списать плиту из общего количества партии (обычный случай на складе)."}
        </p>

        {mode === "slab" ? (
          slabs.length === 0 ? (
            <Alert variant="info" title="Поимённо выделенных плит нет">
              Плита появляется здесь, когда её выделили из партии — по
              фотозапросу клиента или при отправке в шоу-рум.{" "}
              <strong>Чтобы разбить камень из общего склада, используйте «Бой
              в партии»</strong> — там же есть отметка «списать целую плиту».
              Выделять плиту ради того, чтобы сразу её разбить, не нужно.
            </Alert>
          ) : (
            <>
          <Field id="slabId" label={<>Плита <Req /></>} error={e.slabId}>
            <select
              id="slabId"
              name="slabId"
              className={inputClass}
              value={slabId}
              onChange={(ev) => setSlabId(ev.target.value)}
              aria-invalid={e.slabId ? true : undefined}
              aria-describedby={e.slabId ? "slabId-error" : undefined}
            >
              <option value="" disabled>
                — выберите плиту —
              </option>
              {[...slabGroups.entries()].map(([stone, group]) => (
                <optgroup key={stone} label={stone}>
                  {group.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label} — {formatLocation(s.block, s.landmark)}
                      {s.reserved ? " · есть бронь — менеджер будет уведомлён" : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          {selectedSlab && (
            <div className="mt-3 flex gap-3 rounded-card border border-ink/10 bg-paper p-3 text-sm text-ink">
              {selectedSlab.photoId ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={"/api/photo/" + selectedSlab.photoId}
                  alt={selectedSlab.label}
                  className="h-20 w-20 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-ink/[0.04] text-center text-[10px] text-ink/60">
                  нет фото
                </div>
              )}
              <div className="min-w-0">
                <p className="font-semibold">{selectedSlab.stoneName}</p>
                <p className="mt-1 text-ink/70">
                  {selectedSlab.label}
                </p>
                <p className="mt-1 text-ink/70">
                  Габарит: {formatGabarit(selectedSlab.lengthMm, selectedSlab.widthMm, selectedSlab.thicknessMm)}
                  {selectedSlab.areaM2 != null
                    ? ` · ${selectedSlab.areaM2.toFixed(2)} м²`
                    : ""}
                </p>
                <p className="mt-1 text-ink/70">
                  Локация: {formatLocation(selectedSlab.block, selectedSlab.landmark)}
                </p>
                {selectedSlab.reserved && (
                  <p className="mt-1 font-medium text-warning">Есть бронь — менеджер будет уведомлён</p>
                )}
              </div>
            </div>
          )}
            </>
          )
        ) : (
          <div className="flex flex-col gap-4">
            <Field id="batchId" label={<>Партия <Req /></>} error={e.batchId}>
              <select
                id="batchId"
                name="batchId"
                className={inputClass}
                value={batchId}
                onChange={(ev) => setBatchId(ev.target.value)}
                aria-invalid={e.batchId ? true : undefined}
                aria-describedby={e.batchId ? "batchId-error" : undefined}
              >
                <option value="" disabled>
                  — выберите партию —
                </option>
                {[...batchGroups.entries()].map(([stone, group]) => (
                  <optgroup key={stone} label={stone}>
                    {group.map((b) => (
                      <option key={b.id} value={b.id}>
                        от {b.arrived} — {b.qty}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
            {/* fixes0809 BUG-A: §3 always −1 free slab per direct piece — no
                optional checkbox (was a lie). Honest copy only. */}
            <p className="rounded-field border border-ink/10 bg-paper-2 px-3 py-2 text-sm text-ink/70">
              Каждый кусок списывает <strong>1 плиту</strong> из свободного
              остатка партии (учёт §3). Чтобы разбить уже выделенную плиту —
              режим «Плита».
            </p>
          </div>
        )}
      </Card>

      {/* ── Куски ── */}
      <Card>
        <h2 className="mb-1 text-lg font-semibold text-ink">Куски</h2>
        <p className="mb-3 text-sm text-ink/60">
          Обязательны длина и ширина — по ним камень находят в поиске по размеру.
          Длина × ширина — габарит для поиска; стороны — только если кусок
          непрямоугольный (для чертежа).
        </p>
        <div className="mb-3">
          <CrossError msg={e.pieces} />
        </div>
        <div className="flex flex-col gap-4">
          {rowIds.map((id, idx) => {
            const row = rows[id] ?? emptyPiece();
            const isRect = row.isRect !== false;
            return (
            <div key={id} className="rounded-card border border-ink/10 bg-paper p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-base font-semibold text-ink">Кусок {idx + 1}</span>
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
              <div className="flex flex-col gap-3">
                <Field id={`pKind-${idx}`} label={<>Тип <Req /></>} error={e[`p-${idx}-kind`]}>
                  <select
                    id={`pKind-${idx}`}
                    name="pKind"
                    className={inputClass}
                    value={row.kind}
                    onChange={setPiece(id, "kind")}
                    aria-invalid={e[`p-${idx}-kind`] ? true : undefined}
                    aria-describedby={e[`p-${idx}-kind`] ? `pKind-${idx}-error` : undefined}
                  >
                    <option value="BROKEN">Бой</option>
                    <option value="OFFCUT">Остаток</option>
                  </select>
                </Field>
                <p className="text-xs text-ink/55">
                  {row.kind === "OFFCUT"
                    ? "Остаток — годный обрезок после распила."
                    : "Бой — повреждённая/битая плита."}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    id={`pBoundLen-${idx}`}
                    name="pBoundLen"
                    inputMode="numeric"
                    label={<>Длина, см <Req /></>}
                    placeholder="118"
                    value={row.len}
                    onChange={setPiece(id, "len")}
                    error={e[`p-${idx}-boundingLengthMm`]}
                  />
                  <Field
                    id={`pBoundWidth-${idx}`}
                    name="pBoundWidth"
                    inputMode="numeric"
                    label={<>Ширина, см <Req /></>}
                    placeholder="64"
                    value={row.width}
                    onChange={setPiece(id, "width")}
                    error={e[`p-${idx}-boundingWidthMm`]}
                  />
                  <Field
                    id={`pThickness-${idx}`}
                    name="pThickness"
                    inputMode="decimal"
                    label="Толщина, см"
                    placeholder="2 или 1,8"
                    value={row.thickness}
                    onChange={setPiece(id, "thickness")}
                    error={e[`p-${idx}-thicknessMm`]}
                  />
                  <Field
                    id={`pArea-${idx}`}
                    name="pArea"
                    inputMode="decimal"
                    label={isRect ? "Площадь, м² (авто)" : "Площадь, м²"}
                    placeholder="0,6"
                    value={row.area}
                    onChange={setPiece(id, "area")}
                    error={e[`p-${idx}-areaM2`]}
                    readOnly={isRect}
                  />
                  {/* ТЗ №17 §6 — локация куска выбирается из карты склада:
                      свободный ввод здесь плодил бы те же блоки-опечатки. */}
                  <WarehouseLocationSelect
                    blocks={blocks}
                    index={idx}
                    blockName="pBlock"
                    landmarkName="pLandmark"
                    block={row.block}
                    landmark={row.landmark}
                    onBlockChange={setPieceBlock(id)}
                    onLandmarkChange={setPieceValue(id, "landmark")}
                    blockError={e[`p-${idx}-block`]}
                    landmarkError={e[`p-${idx}-landmark`]}
                  />
                </div>
                <label className="flex min-h-11 items-center gap-3 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={!isRect}
                    onChange={(ev) => setPieceRect(id, !ev.target.checked)}
                    className="h-5 w-5 accent-ink"
                  />
                  Кусок непрямоугольный (стороны для чертежа)
                </label>
                {!isRect && (
                  <Field
                    id={`pSides-${idx}`}
                    name="pSides"
                    inputMode="numeric"
                    label="Стороны, см"
                    placeholder="118, 64, 95"
                    value={row.sides}
                    onChange={setPiece(id, "sides")}
                    error={e[`p-${idx}-sidesMm`]}
                    hint="Минимум 3 числа через запятую. Для поиска всё равно нужны длина × ширина."
                  />
                )}
                {isRect && <input type="hidden" name="pSides" value="" />}
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
          + Добавить кусок
        </Button>
      </Card>

      {/* TZ §5.6 — причина (короткий список; AuditLog + экран успеха). */}
      <Card>
        <h2 className="mb-1 text-lg font-semibold text-ink">Причина</h2>
        <p className="mb-3 text-sm text-ink/60">
          Зачем разбили или распилили — для журнала. Один выбор.
        </p>
        <Field
          id="breakCause"
          label={<>Причина <Req /></>}
          error={e.breakCause}
        >
          <select
            id="breakCause"
            name="breakCause"
            className={inputClass}
            value={breakCause}
            onChange={(ev) => setBreakCause(ev.target.value)}
            required
            aria-invalid={e.breakCause ? true : undefined}
            aria-describedby={e.breakCause ? "breakCause-error" : undefined}
          >
            <option value="" disabled>
              — выберите —
            </option>
            {BREAK_CAUSES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.labelRu}
              </option>
            ))}
          </select>
        </Field>
        {breakCause === "OTHER" && (
          <div className="mt-3">
            <Field
              id="breakCauseNote"
              name="breakCauseNote"
              label="Пояснение (необязательно)"
              placeholder="кратко, до 80 символов"
            />
          </div>
        )}
      </Card>

      {/* ── Распил: часть ушла клиенту (только для плиты) ── */}
      {mode === "slab" && (
        <Card>
          <label className="flex min-h-11 items-center gap-3 text-base font-medium text-ink">
            <input
              type="checkbox"
              name="soldPart"
              value="1"
              checked={soldPart}
              onChange={(ev) => setSoldPart(ev.target.checked)}
              className="h-6 w-6 accent-ink"
            />
            Часть ушла клиенту / в изделие (распил)
          </label>
          {soldPart && (
            <div className="mt-3 flex flex-col gap-4">
              <p className="text-sm text-ink/60">
                Факт попадёт в журнал. Продажу оформляет менеджер в разделе продаж.
              </p>
              <Field
                id="soldCustomerName"
                name="soldCustomerName"
                label={<>Кому <Req /></>}
                placeholder="Клиент / заказ"
                error={e.soldCustomerName}
              />
              <Field
                id="soldPrice"
                name="soldPrice"
                inputMode="decimal"
                label="Цена (если известна)"
                placeholder="250"
                error={e.soldPrice}
              />
            </div>
          )}
        </Card>
      )}

      {/* Липкая нижняя панель — большой палец достаёт CTA на мобиле; на
          десктопе (md:) возвращается в обычный поток. Реальный submit формы
          (без JS) сохраняется — устойчивость к слабой сети. */}
      <div
        className="sticky bottom-0 z-10 -mx-4 border-t border-ink/10 bg-paper/90 px-4 py-3 backdrop-blur
                   md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-0 md:backdrop-blur-none"
      >
        {confirming ? (
          <div className="flex flex-col gap-3">
            <Alert variant="warning" title="Проверьте данные выше.">
              {mode === "slab"
                ? "Плита будет переведена в «Бой / остаток» — вернуть её обратно нельзя."
                : "Бой будет записан в партию и спишется из её остатка."}
            </Alert>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => setConfirming(false)}
                className="min-h-14 flex-1 text-lg"
              >
                Назад
              </Button>
              <Button
                type="submit"
                disabled={pending}
                className="min-h-14 flex-1 text-lg font-bold"
              >
                {pending ? "Запись…" : "Подтвердить"}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            onClick={() => setConfirming(true)}
            className="min-h-14 w-full text-lg font-bold"
          >
            Продолжить
          </Button>
        )}
      </div>
    </form>
  );
}
