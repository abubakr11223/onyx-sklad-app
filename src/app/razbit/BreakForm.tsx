"use client";

// Форма «Разбить камень» (TZ §5.6, §6.4) — складчик с телефона:
// крупные поля, минимум текста, шаг подтверждения перед записью.
// C-batch: разметка переведена на бренд-дизайн-систему (Button/Field/Card/Alert).
// Поведение, имена полей, порядок строк и контракт валидации НЕ менялись.

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { submitBreak, type BreakFormState } from "./actions";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field, { inputClass } from "@/components/ui/Field";
import Alert from "@/components/ui/Alert";

export interface SlabOption {
  id: string;
  label: string;
  stoneName: string;
  reserved: boolean;
  block: string;
  landmark: string;
}

export interface BatchOption {
  id: string;
  stoneName: string;
  arrived: string; // уже отформатированная дата
  qty: string; // «40 плит / 220 м²»
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
}: {
  slabs: SlabOption[];
  batches: BatchOption[];
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
  const [rows, setRows] = useState<Record<number, PieceVals>>({
    0: emptyPiece(),
  });
  const setPiece =
    (id: number, key: keyof PieceVals) =>
    (ev: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setRows((m) => ({
        ...m,
        [id]: { ...(m[id] ?? emptyPiece()), [key]: ev.target.value },
      }));

  // CRIT-01 (ТЗ №4): при ошибке валидации ВЫХОДИМ из шага подтверждения, чтобы
  // ошибки полей стали видны (иначе submit «молча не проходит» — ошибки висят на
  // скрытых сверху полях, а форма застряла на «Подтвердить»).
  useEffect(() => {
    if (Object.keys(state.errors).length > 0) setConfirming(false);
  }, [state]);

  const addRow = () => {
    const id = nextRowId.current++;
    setRowIds((ids) => [...ids, id]);
    setRows((m) => ({ ...m, [id]: emptyPiece() }));
  };
  const removeRow = (id: number) =>
    setRowIds((ids) => (ids.length > 1 ? ids.filter((x) => x !== id) : ids));

  const slabGroups = groupBy(slabs, (s) => s.stoneName);
  const batchGroups = groupBy(batches, (b) => b.stoneName);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {e.form && <Alert variant="danger">{e.form}</Alert>}
      <input type="hidden" name="mode" value={mode} />

      {/* ── Что разбиваем ── */}
      <Card>
        <h2 className="mb-3 text-lg font-semibold text-ink">Что разбиваем</h2>
        <div className="mb-4 flex gap-2">
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

        {mode === "slab" ? (
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
                      {s.label} — блок {s.block}, ориентир {s.landmark}
                      {s.reserved ? " · есть бронь — менеджер будет уведомлён" : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
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
            <label className="flex min-h-11 items-center gap-3 rounded-field border border-ink/15 bg-paper p-3 text-base text-ink">
              <input
                type="checkbox"
                name="decrementSlabs"
                value="1"
                defaultChecked
                className="h-6 w-6 accent-ink"
              />
              Это была целая плита партии (списать плиту)
            </label>
          </div>
        )}
      </Card>

      {/* ── Куски ── */}
      <Card>
        <h2 className="mb-1 text-lg font-semibold text-ink">Куски</h2>
        <p className="mb-3 text-sm text-ink/60">
          Обязательны длина и ширина (по ним ищут остаток). «Стороны» —
          необязательно: заполните, если кусок непрямоугольный (для чертежа).
        </p>
        <div className="mb-3">
          <CrossError msg={e.pieces} />
        </div>
        <div className="flex flex-col gap-4">
          {rowIds.map((id, idx) => (
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
                    value={rows[id]?.kind ?? "BROKEN"}
                    onChange={setPiece(id, "kind")}
                    aria-invalid={e[`p-${idx}-kind`] ? true : undefined}
                    aria-describedby={e[`p-${idx}-kind`] ? `pKind-${idx}-error` : undefined}
                  >
                    <option value="BROKEN">Бой</option>
                    <option value="OFFCUT">Остаток</option>
                  </select>
                </Field>
                <Field
                  id={`pSides-${idx}`}
                  name="pSides"
                  inputMode="numeric"
                  label="Стороны, мм (необязательно)"
                  placeholder="если непрямоугольный: 1180, 640, 950"
                  value={rows[id]?.sides ?? ""}
                  onChange={setPiece(id, "sides")}
                  error={e[`p-${idx}-sidesMm`]}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    id={`pBoundLen-${idx}`}
                    name="pBoundLen"
                    inputMode="numeric"
                    label={<>Длина, мм <Req /></>}
                    placeholder="1180"
                    value={rows[id]?.len ?? ""}
                    onChange={setPiece(id, "len")}
                    error={e[`p-${idx}-boundingLengthMm`]}
                  />
                  <Field
                    id={`pBoundWidth-${idx}`}
                    name="pBoundWidth"
                    inputMode="numeric"
                    label={<>Ширина, мм <Req /></>}
                    placeholder="640"
                    value={rows[id]?.width ?? ""}
                    onChange={setPiece(id, "width")}
                    error={e[`p-${idx}-boundingWidthMm`]}
                  />
                  <Field
                    id={`pThickness-${idx}`}
                    name="pThickness"
                    inputMode="numeric"
                    label="Толщина, мм"
                    placeholder="20"
                    value={rows[id]?.thickness ?? ""}
                    onChange={setPiece(id, "thickness")}
                    error={e[`p-${idx}-thicknessMm`]}
                  />
                  <Field
                    id={`pArea-${idx}`}
                    name="pArea"
                    inputMode="decimal"
                    label="Площадь, м²"
                    placeholder="0,6"
                    value={rows[id]?.area ?? ""}
                    onChange={setPiece(id, "area")}
                    error={e[`p-${idx}-areaM2`]}
                  />
                  <Field
                    id={`pBlock-${idx}`}
                    name="pBlock"
                    label={<>Блок <Req /></>}
                    placeholder="А"
                    value={rows[id]?.block ?? ""}
                    onChange={setPiece(id, "block")}
                    error={e[`p-${idx}-block`]}
                  />
                  <Field
                    id={`pLandmark-${idx}`}
                    name="pLandmark"
                    label={<>Ориентир <Req /></>}
                    placeholder="2 или 1–2"
                    value={rows[id]?.landmark ?? ""}
                    onChange={setPiece(id, "landmark")}
                    error={e[`p-${idx}-landmark`]}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        <Button
          variant="secondary"
          onClick={addRow}
          className="mt-3 w-full border-dashed"
        >
          + Добавить кусок
        </Button>
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
