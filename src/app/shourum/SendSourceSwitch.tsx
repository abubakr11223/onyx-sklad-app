"use client";

// ТЗ №20 §8 «Шоу-рум»: источник отправки — сегмент-контрол «Из партии /
// Готовая плита / Бой». Переключатель только показывает одну из трёх
// серверных форм (поля, action приходят пропами; все шлют то же действие
// sendToShowroomAction). Все остаются в DOM (скрытые — атрибутом hidden).

import { useState, type ReactNode } from "react";
import SegmentedControl from "@/components/ui/SegmentedControl";

type Source = "batch" | "slab" | "piece";

export default function SendSourceSwitch({
  batchForm,
  slabForm,
  pieceForm,
  initial = "batch",
}: {
  batchForm: ReactNode;
  slabForm: ReactNode;
  pieceForm: ReactNode;
  initial?: Source;
}) {
  const [source, setSource] = useState<Source>(initial);
  return (
    <>
      <SegmentedControl
        className="mb-4"
        label="Откуда отправить"
        value={source}
        onChange={setSource}
        options={[
          { value: "batch", label: "Из партии" },
          { value: "slab", label: "Готовая плита" },
          { value: "piece", label: "Бой" },
        ]}
        hint={
          source === "batch"
            ? "Плита выделяется из партии и сразу уходит на витрину."
            : source === "slab"
              ? "Уже выделенная плита."
              : "Кусок боя или остаток."
        }
      />
      <div hidden={source !== "batch"}>{batchForm}</div>
      <div hidden={source !== "slab"}>{slabForm}</div>
      <div hidden={source !== "piece"}>{pieceForm}</div>
    </>
  );
}
