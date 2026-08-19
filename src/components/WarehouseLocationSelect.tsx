"use client";

// ТЗ №17 §6 — выбор локации из справочника вместо свободного ввода.
//
// Заменяет пару input+datalist (WarehouseGridDatalists): datalist только
// ПОДСКАЗЫВАЛ, а набрать можно было что угодно — так и рос второй справочник из
// опечаток. Здесь нативный <select>: значения только из сетки склада.
//
// Почему нативный контрол, а не JS-комбобокс с поиском: склад работает с
// телефона на слабой сети, нативный список открывается системным виджетом,
// поиск по коду работает набором с клавиатуры (type-ahead), и он остаётся
// доступным без JS. Блоков десятки, не тысячи — этого достаточно.
//
// Ориентиры реактивны: список зависит от выбранного блока. При смене блока
// ориентир сбрасывается — «ориентир 5» из другого блока это другое место.
//
// ВАЖНО: селекты НЕ делаются disabled даже когда выбирать нечего. Локации в
// форме — параллельные массивы (locBlock[i] ↔ locLandmark[i]); disabled-контрол
// не отправляется, индексы съезжают, и третья локация получила бы ориентир
// второй. Пустой список = только placeholder-опция.

import Field, { inputClass } from "@/components/ui/Field";

export interface WarehouseBlockOption {
  letter: string;
  landmarks: string[];
}

interface Props {
  blocks: WarehouseBlockOption[];
  /** Индекс строки локации в форме — для id и ключей ошибок. */
  index: number;
  block: string;
  landmark: string;
  onBlockChange: (value: string) => void;
  onLandmarkChange: (value: string) => void;
  blockError?: string;
  landmarkError?: string;
  /** Имена полей формы (в приёмке — locBlock/locLandmark). */
  blockName?: string;
  landmarkName?: string;
}

export default function WarehouseLocationSelect({
  blocks,
  index,
  block,
  landmark,
  onBlockChange,
  onLandmarkChange,
  blockError,
  landmarkError,
  blockName = "locBlock",
  landmarkName = "locLandmark",
}: Props) {
  const current = blocks.find((b) => b.letter === block);
  const landmarks = current?.landmarks ?? [];

  // Сетка пуста — блоков ещё не завели. Молча показывать пустой список нельзя:
  // складчик решит, что форма сломана. Говорим, что делать и кому.
  const gridEmpty = blocks.length === 0;

  return (
    <>
      <Field
        id={`locBlock-${index}`}
        label={
          <>
            Блок <span className="text-danger">*</span>
          </>
        }
        error={blockError}
        hint={
          gridEmpty
            ? "Карта склада пуста — блоки заводит владелец или зав. складом."
            : undefined
        }
      >
        <select
          id={`locBlock-${index}`}
          name={blockName}
          className={inputClass}
          value={block}
          aria-invalid={blockError ? true : undefined}
          onChange={(ev) => onBlockChange(ev.target.value)}
        >
          <option value="">— выберите блок —</option>
          {/* Значение, которого уже нет в сетке (блок переименовали, пока форма
              была открыта): показываем, чтобы поле не «обнулилось» молча. */}
          {block !== "" && !current && (
            <option value={block}>{block} (нет в карте)</option>
          )}
          {blocks.map((b) => (
            <option key={b.letter} value={b.letter}>
              {b.letter}
            </option>
          ))}
        </select>
      </Field>

      <Field
        id={`locLandmark-${index}`}
        label={
          <>
            Ориентир <span className="text-danger">*</span>
          </>
        }
        error={landmarkError}
        hint={
          block && landmarks.length === 0 && !landmarkError
            ? "В этом блоке нет ориентиров — добавьте их в «Карте склада»."
            : undefined
        }
      >
        <select
          id={`locLandmark-${index}`}
          name={landmarkName}
          className={inputClass}
          value={landmark}
          aria-invalid={landmarkError ? true : undefined}
          onChange={(ev) => onLandmarkChange(ev.target.value)}
        >
          <option value="">{block ? "— выберите ориентир —" : "— сначала блок —"}</option>
          {landmark !== "" && !landmarks.includes(landmark) && (
            <option value={landmark}>{landmark} (нет в карте)</option>
          )}
          {landmarks.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}
