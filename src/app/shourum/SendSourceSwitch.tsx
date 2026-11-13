"use client";

// ТЗ №20 §8 «Шоу-рум»: источник отправки — сегмент-контрол «Из партии /
// Готовая плита · бой». Переключатель только показывает одну из двух
// существующих серверных форм; сами формы (поля, action) приходят пропами
// без изменений. Обе остаются в DOM (скрытая — атрибутом hidden).

import { useState, type ReactNode } from "react";
import SegmentedControl from "@/components/ui/SegmentedControl";

type Source = "batch" | "unit";

export default function SendSourceSwitch({
  batchForm,
  unitForm,
  initial = "batch",
}: {
  batchForm: ReactNode;
  unitForm: ReactNode;
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
          { value: "unit", label: "Готовая плита / бой" },
        ]}
        hint={
          source === "batch"
            ? "Плита выделяется из партии и сразу уходит на витрину."
            : "Уже выделенная плита или кусок боя / остатка."
        }
      />
      <div hidden={source !== "batch"}>{batchForm}</div>
      <div hidden={source !== "unit"}>{unitForm}</div>
    </>
  );
}
