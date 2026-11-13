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
import type { ReactNode } from "react";
import { submitBreak, type BreakFormState } from "./actions";
import {
  breakLeftoverItems,
  breakRenderedKeys,
} from "./break-form-errors";
import { BREAK_CAUSES } from "@/lib/breaking";
import SegmentedControl from "@/components/ui/SegmentedControl";
import Badge from "@/components/ui/Badge";
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
  qty: string; // «свободно 4 плит / 16,4 м²» — свободный, не принятый (ТЗ №19 B3)
  /** Толщина однородной партии, см — подставляется в кусок. */
  thicknessMm?: number | null;
  /** ТЗ №19 B3 — узоры партии; есть → узор обязателен. */
  patterns?: BatchPatternOption[];
}

/** ТЗ №19 B3 — узор как источник боя. */
export interface BatchPatternOption {
  id: string;
  /** «ТЕСТ светлый 2см · 280×160×2 см · свободно 3 пл. / 13,4 м² · Блок A1» */
  label: string;
  thicknessMm: number | null;
  hasFree: boolean;
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
  return <span className="text-carnelian">*</span>;
}

/** Кросс-полевая ошибка (не привязана к одному input — напр. pieces). */
function CrossError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="text-sm font-medium text-carnelian">{msg}</p>;
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
  before,
  aside,
}: {
  slabs: SlabOption[];
  batches: BatchOption[];
  blocks?: BlockOption[];
  /** Содержимое над формой в левой колонке (фильтр, баннеры) — вне <form>. */
  before?: ReactNode;
  /** Правая колонка на широком экране (≥1280px) — над сводкой. */
  aside?: ReactNode;
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
  const [batchPatternId, setBatchPatternId] = useState("");
  const [slabId, setSlabId] = useState("");
  const [breakCause, setBreakCause] = useState("");
  const [rows, setRows] = useState<Record<number, PieceVals>>({
    0: emptyPiece(),
  });
  // ТЗ №19 B3 — выбор узора/партии подставляет толщину во все куски
  // (поле остаётся редактируемым: кусок может быть другой толщины).
  const fillThickness = (t: number | null) => {
    if (t == null) return;
    const txt = String(t).replace(".", ",");
    setRows((m) =>
      Object.fromEntries(
        Object.entries(m).map(([k, v]) => [k, { ...v, thickness: txt }]),
      ),
    );
  };
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
  const selectedBatch = batches.find((b) => b.id === batchId) ?? null;

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

  // ТЗ №20 §8 — сводка справа (≥1280px): только чтение из состояния формы.
  const parseNum = (v: string) => {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const summaryArea = rowIds.reduce((sum, id) => sum + parseNum(rows[id]?.area ?? ""), 0);
  const summaryBroken = rowIds.filter((id) => (rows[id]?.kind ?? "BROKEN") === "BROKEN").length;
  const summaryWhat =
    mode === "slab"
      ? selectedSlab
        ? `${selectedSlab.stoneName} · ${selectedSlab.label}`
        : null
      : selectedBatch
        ? `${selectedBatch.stoneName} · ${selectedBatch.arrived}`
        : null;
  const summaryCause = BREAK_CAUSES.find((c) => c.code === breakCause)?.labelRu ?? null;

  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,760px)_320px] xl:items-start xl:gap-6">
    <div className="min-w-0">
    {before}
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
        <h2 className="mb-3 text-base font-semibold text-ink">Что разбиваем</h2>
        <SegmentedControl
          className="mb-4"
          label="Что разбиваем"
          value={mode}
          onChange={setMode}
          options={[
            { value: "slab", label: "Плита" },
            { value: "direct", label: "Бой в партии" },
          ]}
          hint={
            mode === "slab"
              ? "Плита — разбить конкретную выделенную плиту (была выбрана под клиента)."
              : "Бой в партии — разбить/списать плиту из общего количества партии (обычный случай на складе)."
          }
        />

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
            /* ТЗ №20 §7.5 — карточка камня: фото 72×72 слева, справа вид,
               плита, габарит и локация моно, бронь — бейджем. */
            <div className="mt-3 flex gap-3 rounded-card border border-line bg-marble p-3 text-sm text-ink">
              {selectedSlab.photoId ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={"/api/photo/" + selectedSlab.photoId}
                  alt={selectedSlab.label}
                  className="h-[72px] w-[72px] shrink-0 rounded-field object-cover"
                />
              ) : (
                <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-field bg-stone-100 text-center text-xs text-ink-2">
                  нет фото
                </div>
              )}
              <div className="min-w-0">
                <p className="font-medium">{selectedSlab.stoneName}</p>
                <p className="mt-0.5 font-mono text-xs text-ink-2">
                  {selectedSlab.label}
                </p>
                <p className="mt-1 text-ink-2">
                  Габарит:{" "}
                  <span className="font-mono text-ink">
                    {formatGabarit(selectedSlab.lengthMm, selectedSlab.widthMm, selectedSlab.thicknessMm)}
                  </span>
                  {selectedSlab.areaM2 != null
                    ? ` · ${selectedSlab.areaM2.toFixed(2)} м²`
                    : ""}
                </p>
                <p className="mt-0.5 text-ink-2">
                  Локация:{" "}
                  <span className="font-mono text-ink">
                    {formatLocation(selectedSlab.block, selectedSlab.landmark)}
                  </span>
                </p>
                {selectedSlab.reserved && (
                  <Badge variant="warning" className="mt-1.5">Есть бронь — менеджер будет уведомлён</Badge>
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
                onChange={(ev) => {
                  setBatchId(ev.target.value);
                  setBatchPatternId("");
                  // ТЗ №19 B3 — толщина куска из партии (редактируемая).
                  const b = batches.find((x) => x.id === ev.target.value);
                  if (b && !b.patterns?.length) fillThickness(b.thicknessMm ?? null);
                }}
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
                        {b.stoneName} · от {b.arrived} — {b.qty}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
            {/* ТЗ №19 B3 — смешанная партия: бой списывается из узора. */}
            {(selectedBatch?.patterns?.length ?? 0) > 0 && (
              <Field id="batchPatternId" label={<>Узор <Req /></>} error={e.batchPatternId}>
                <select
                  id="batchPatternId"
                  name="batchPatternId"
                  className={inputClass}
                  value={batchPatternId}
                  onChange={(ev) => {
                    setBatchPatternId(ev.target.value);
                    const pat = selectedBatch?.patterns?.find((p) => p.id === ev.target.value);
                    fillThickness(pat?.thicknessMm ?? null);
                  }}
                >
                  <option value="" disabled>
                    — из какого узора бой —
                  </option>
                  {selectedBatch!.patterns!.map((p) => (
                    <option key={p.id} value={p.id} disabled={!p.hasFree}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {/* fixes0809 BUG-A: §3 always −1 free slab per direct piece — no
                optional checkbox (was a lie). Honest copy only. */}
            <p className="rounded-field border border-line bg-stone-100 px-3 py-2 text-sm text-ink-2">
              Каждый кусок списывает <strong>1 плиту</strong> из свободного
              остатка партии (учёт §3). Чтобы разбить уже выделенную плиту —
              режим «Плита».
            </p>
          </div>
        )}
      </Card>

      {/* ── Куски ── */}
      <Card>
        <h2 className="mb-1 text-base font-semibold text-ink">Куски</h2>
        <p className="mb-3 text-sm text-ink-2">
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
            <div key={id} className="rounded-card border border-line bg-marble p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-base font-semibold text-ink">Кусок {idx + 1}</span>
                {rowIds.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeRow(id)}
                    className="text-carnelian hover:bg-carnelian-bg"
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
                <p className="text-xs text-ink-2">
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
        <h2 className="mb-1 text-base font-semibold text-ink">Причина</h2>
        <p className="mb-3 text-sm text-ink-2">
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
              <p className="text-sm text-ink-2">
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
        className="sticky bottom-[calc(56px+env(safe-area-inset-bottom))] z-30 -mx-4 border-t border-line bg-marble px-4 py-3 md:static md:mx-0 md:border-0 md:bg-transparent md:p-0"
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
                className="flex-1 md:flex-none"
              >
                Назад
              </Button>
              <Button
                type="submit"
                pending={pending}
                className="flex-1 md:flex-none"
              >
                {pending ? "Запись…" : "Подтвердить"}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            onClick={() => setConfirming(true)}
            className="w-full md:w-auto"
          >
            Продолжить
          </Button>
        )}
      </div>
    </form>
    </div>
    <aside className="sticky top-6 hidden flex-col gap-4 xl:flex">
      {aside}
      <Card>
        <h2 className="text-base font-semibold text-ink">Сводка</h2>
        <dl className="mt-3 flex flex-col gap-3 text-sm">
          <div>
            <dt className="text-xs font-medium text-ink-2">Что разбиваем</dt>
            <dd className="mt-0.5 text-ink">
              {mode === "slab" ? "Плита" : "Бой в партии"}
              {summaryWhat ? (
                <span className="block font-mono text-sm">{summaryWhat}</span>
              ) : (
                <span className="block text-ink-2">ещё не выбрано</span>
              )}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-xs font-medium text-ink-2">Кусков</dt>
            <dd className="tnum text-ink">
              {rowIds.length}
              {rowIds.length > 0 && (
                <span className="text-ink-2">
                  {" "}
                  · бой {summaryBroken}, остаток {rowIds.length - summaryBroken}
                </span>
              )}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-xs font-medium text-ink-2">Площадь, м²</dt>
            <dd className="tnum text-ink">
              {summaryArea > 0 ? summaryArea.toFixed(3).replace(".", ",") : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-xs font-medium text-ink-2">Причина</dt>
            <dd className="text-right text-ink">{summaryCause ?? "—"}</dd>
          </div>
        </dl>
      </Card>
    </aside>
    </div>
  );
}
