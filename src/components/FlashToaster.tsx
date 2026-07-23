"use client";

// Мост «флеш-параметр → тост»: server actions делают redirect с ?photo=ok /
// ?leadErr=... — тут читаем их, показываем тост и ЧИСТИМ URL (replace), чтобы при
// перезагрузке тост не повторялся. Курируемый набор ключей (не глобальный ok/error,
// чтобы не дублировать баннеры страниц). useSearchParams требует Suspense (в layout).
import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast, type ToastVariant } from "@/components/ui/toast";

type Rule = {
  key: string;
  variant: ToastVariant;
  // Фиксированный текст, либо взять значение параметра как сообщение (для ошибок).
  message: string | "@value";
};

const RULES: Rule[] = [
  { key: "photo", variant: "success", message: "Запрос на фото отправлен складчикам" },
  { key: "photoErr", variant: "danger", message: "@value" },
  { key: "lead", variant: "success", message: "Запрос отправлен менеджеру" },
  { key: "leadErr", variant: "danger", message: "@value" },
];

export default function FlashToaster() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // Один показ на комбинацию параметров (StrictMode/повторные рендеры).
  const shown = useRef<string>("");

  useEffect(() => {
    const hits = RULES.filter((r) => sp.has(r.key));
    if (hits.length === 0) return;

    const signature = hits.map((r) => `${r.key}=${sp.get(r.key)}`).join("&");
    if (shown.current === signature) return;
    shown.current = signature;

    for (const r of hits) {
      const raw = sp.get(r.key) ?? "";
      const msg = r.message === "@value" ? raw || "Ошибка" : r.message;
      toast(msg, r.variant);
    }

    // Убрать обработанные ключи из URL, остальные сохранить.
    const next = new URLSearchParams(sp.toString());
    for (const r of hits) next.delete(r.key);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [sp, router, pathname]);

  return null;
}
