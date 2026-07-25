// Аудит ТЗ №7 #14 — datalist-markup (id="wh-blocks" + id="wh-lm-{letter}")
// одинаков в приёмке и в разбитии. Одна точка = одинаковые id, порядок,
// поведение. Пустой массив → ничего не рендерим (input list='wh-blocks' тогда
// просто без подсказок — существующее поведение, не меняется).

export interface WarehouseBlockOption {
  letter: string;
  landmarks: string[];
}

interface Props {
  blocks: WarehouseBlockOption[];
}

export default function WarehouseGridDatalists({ blocks }: Props) {
  if (blocks.length === 0) return null;
  return (
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
  );
}
