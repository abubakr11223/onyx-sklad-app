"use client";
// ТЗ №20 G — кнопка «Печать»: открывает системный диалог печати браузера
// (§8.3: печать через браузер / PDF, без интеграции с принтером).
import { buttonClass } from "@/components/ui/Button";

export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={buttonClass("primary", "md")}
    >
      Печать
    </button>
  );
}
