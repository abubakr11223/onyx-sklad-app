"use client";

// §5.5b — «Бой по фото»: форма замеров (клиентская часть страницы /singan).
//
// W3-T2. Было: обычный <form action={serverAction}>, любая ошибка = redirect на
// ?err=… — и ВСЕ введённые стороны стирались. Замеры куска рулеткой снимают
// один раз; терять их из-за опечатки в одном поле нельзя.
//
// Стало — проверенный в репозитории паттерн (IntakeForm/BreakForm/SaleForm):
// useActionState + КОНТРОЛИРУЕМЫЕ поля. React 19 сбрасывает только
// неконтролируемые input'ы при возврате состояния из экшена; здесь значения
// живут в state и переживают ответ сервера. Для сценария без JS экшен ещё и
// возвращает эхо значений (state.values) — им инициализируется state.
//
// Двойное касание: кнопка блокируется на время отправки (pending), а сервер
// держит вторую линию — mutationId + квитанция (singan-receipt.ts).

import { useActionState, useState } from "react";
import { submitSingan, type SinganFormState } from "./actions";
import { singanLeftoverItems } from "./singan-form-errors";
import { BREAK_CAUSES } from "@/lib/breaking";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field, { inputClass } from "@/components/ui/Field";
import Alert from "@/components/ui/Alert";
import WarehouseLocationSelect, {
  type WarehouseBlockOption,
} from "@/components/WarehouseLocationSelect";

export interface SinganBatchOption {
  id: string;
  label: string;
}

const initialState: SinganFormState = { errors: {} };

/**
 * W3-T2 — клиентский mutationId (как в приёмке, W7-A2). Минтуется ОДИН раз на
 * монтирование: он не меняется от неудачной валидации, поэтому повтор после
 * исправления опечатки — тот же логический бой, а не второй кусок. Новый id
 * появляется только на новой странице (после успеха идёт redirect на ?ok=1).
 */
function newMutationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export default function SinganForm({
  d,
  svg,
  sideCount,
  batches,
  blocks,
}: {
  /** Draft из ссылки бота — уходит обратно на сервер как есть. */
  d: string;
  /** Готовый SVG-чертёж (собран сервером из проверенного полигона). */
  svg: string;
  sideCount: number;
  batches: SinganBatchOption[];
  blocks: WarehouseBlockOption[];
}) {
  const [state, formAction, pending] = useActionState(
    submitSingan,
    initialState,
  );
  const e = state.errors;

  // Инициализация из эха сервера — путь без JS (полная перезагрузка после
  // POST): значения приходят в state.values и не теряются. С JS эхо не нужно —
  // state и так живёт в браузере.
  const [sides, setSides] = useState<string[]>(
    () => state.values?.sides ?? Array.from({ length: sideCount }, () => ""),
  );
  const [boundingLengthMm, setBoundingLengthMm] = useState(
    () => state.values?.boundingLengthMm ?? "",
  );
  const [boundingWidthMm, setBoundingWidthMm] = useState(
    () => state.values?.boundingWidthMm ?? "",
  );
  const [thicknessMm, setThicknessMm] = useState(
    () => state.values?.thicknessMm ?? "",
  );
  const [areaM2, setAreaM2] = useState(() => state.values?.areaM2 ?? "");
  const [kind, setKind] = useState(() => state.values?.kind || "BROKEN");
  const [batchId, setBatchId] = useState(() => state.values?.batchId ?? "");
  const [block, setBlock] = useState(() => state.values?.block ?? "");
  const [landmark, setLandmark] = useState(() => state.values?.landmark ?? "");
  const [breakCause, setBreakCause] = useState(
    () => state.values?.breakCause ?? "",
  );
  const [breakCauseNote, setBreakCauseNote] = useState(
    () => state.values?.breakCauseNote ?? "",
  );
  const [mutationId] = useState(newMutationId);

  const setSide = (i: number, value: string) =>
    setSides((prev) => {
      const next = [...prev];
      next[i] = value;
      return next;
    });

  // Ключи, которые сервер вернул, а форма не рисует ни на одном поле.
  const leftovers = singanLeftoverItems(e, sideCount);
  const topMessages = [
    ...new Set([...(e.form ? [e.form] : []), ...leftovers]),
  ];

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="d" value={d} />
      {/* W3-T2 — один логический бой = один mutationId (де-дубль на сервере). */}
      <input type="hidden" name="mutationId" value={mutationId} />

      {topMessages.length > 0 && (
        <Alert variant="danger" title="Проверьте данные">
          {topMessages.length === 1 ? (
            <p className="text-base font-semibold">{topMessages[0]}</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-base">
              {topMessages.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}

      <div className="flex justify-center rounded-card border border-ink/10 bg-paper-2/60 p-4">
        {/* SVG — наш renderChertyoj (валидация + экранирование на сервере). */}
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      </div>

      {/* ── Стороны ── */}
      <Card>
        <h2 className="mb-3 text-lg font-semibold text-ink">
          Стороны, см ({sideCount})
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: sideCount }, (_, i) => i + 1).map((n) => (
            <Field
              key={n}
              id={`side_${n}`}
              name={`side_${n}`}
              inputMode="numeric"
              label={`Сторона ${n}`}
              placeholder="напр. 118"
              required
              value={sides[n - 1] ?? ""}
              onChange={(ev) => setSide(n - 1, ev.target.value)}
              error={e[`side_${n}`]}
            />
          ))}
        </div>
      </Card>

      {/* ── Габариты и площадь ── */}
      <Card>
        <h2 className="mb-3 text-lg font-semibold text-ink">Габариты и площадь</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field
            id="boundingLengthMm"
            name="boundingLengthMm"
            inputMode="numeric"
            label="Длина, см"
            required
            value={boundingLengthMm}
            onChange={(ev) => setBoundingLengthMm(ev.target.value)}
            error={e.boundingLengthMm}
          />
          <Field
            id="boundingWidthMm"
            name="boundingWidthMm"
            inputMode="numeric"
            label="Ширина, см"
            required
            value={boundingWidthMm}
            onChange={(ev) => setBoundingWidthMm(ev.target.value)}
            error={e.boundingWidthMm}
          />
          {/* ТЗ №12 — толщина ДРОБНАЯ: 18 мм = 1,8 см (как в /razbit). */}
          <Field
            id="thicknessMm"
            name="thicknessMm"
            inputMode="decimal"
            label="Толщина, см"
            placeholder="напр. 1,8"
            value={thicknessMm}
            onChange={(ev) => setThicknessMm(ev.target.value)}
            error={e.thicknessMm}
            hint="Необязательно. Дробная: 18 мм → 1,8"
          />
          <Field
            id="areaM2"
            name="areaM2"
            inputMode="decimal"
            label="Площадь, м²"
            placeholder="необязательно"
            value={areaM2}
            onChange={(ev) => setAreaM2(ev.target.value)}
            error={e.areaM2}
          />
        </div>
      </Card>

      {/* ── Партия и место ── */}
      <Card>
        <h2 className="mb-3 text-lg font-semibold text-ink">Партия и место</h2>
        <div className="flex flex-col gap-4">
          <Field id="kind" label="Тип" error={e.kind}>
            <select
              id="kind"
              name="kind"
              className={inputClass}
              value={kind}
              onChange={(ev) => setKind(ev.target.value)}
            >
              <option value="BROKEN">Бой</option>
              <option value="OFFCUT">Остаток</option>
            </select>
          </Field>
          <Field id="batchId" label="Партия (камень)" error={e.batchId}>
            <select
              id="batchId"
              name="batchId"
              required
              className={inputClass}
              value={batchId}
              aria-invalid={e.batchId ? true : undefined}
              onChange={(ev) => setBatchId(ev.target.value)}
            >
              <option value="">— выберите партию —</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </Field>
          <p className="rounded-field border border-ink/10 bg-paper-2 px-3 py-2 text-sm text-ink/70">
            Кусок списывает <strong>1 плиту</strong> из свободного остатка
            партии (учёт §3).
          </p>
          {/* ТЗ №17 §6 — блок только из карты склада; ТЗ №18 §2 — ориентир
              необязателен (тот же контрол, что в приёмке и /razbit). */}
          <div className="grid grid-cols-2 gap-3">
            <WarehouseLocationSelect
              blocks={blocks}
              index={0}
              blockName="block"
              landmarkName="landmark"
              block={block}
              landmark={landmark}
              onBlockChange={(v) => {
                setBlock(v);
                setLandmark(""); // другой блок — другой смысл у номера
              }}
              onLandmarkChange={setLandmark}
              blockError={e.block}
              landmarkError={e.landmark}
            />
          </div>
          {/* TZ §5.6 — same cause list as /razbit (both paths → AuditLog). */}
          <Field id="breakCause" label="Причина" error={e.breakCause}>
            <select
              id="breakCause"
              name="breakCause"
              required
              className={inputClass}
              value={breakCause}
              aria-invalid={e.breakCause ? true : undefined}
              onChange={(ev) => setBreakCause(ev.target.value)}
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
          <Field
            id="breakCauseNote"
            name="breakCauseNote"
            label="Пояснение (если «Другое»)"
            placeholder="необязательно, до 80 символов"
            value={breakCauseNote}
            onChange={(ev) => setBreakCauseNote(ev.target.value)}
          />
        </div>
      </Card>

      {/* Липкая нижняя панель отправки — CTA под большим пальцем на мобиле;
          на десктопе (md:) возвращается в обычный поток. */}
      <div
        className="sticky bottom-0 z-10 -mx-4 border-t border-ink/10 bg-paper/90 px-4 py-3 backdrop-blur
                   md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-0 md:backdrop-blur-none"
      >
        <Button
          type="submit"
          disabled={pending}
          className="min-h-14 w-full text-lg font-bold"
        >
          {pending ? "Запись…" : "Сохранить"}
        </Button>
      </div>
    </form>
  );
}
