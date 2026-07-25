"use client";

// §5.9 — В Telegram Mini App нет браузерной кнопки «назад». Управляем нативной
// Telegram BackButton: показываем её на всех страницах кроме главной, по клику —
// history.back(). Вне Telegram (обычный сайт) ничего не делает (SDK-заглушка).
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

interface TgBackButton {
  show: () => void;
  hide: () => void;
  onClick: (cb: () => void) => void;
  offClick: (cb: () => void) => void;
}
interface TgWebApp {
  BackButton?: TgBackButton;
}

export default function TelegramBackButton() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    let bb: TgBackButton | null = null;
    let tries = 0;
    const onClick = () => {
      if (window.history.length > 1) window.history.back();
      else router.push("/");
    };
    const wire = () => {
      if (cancelled) return;
      const tg = (globalThis as unknown as { Telegram?: { WebApp?: TgWebApp } })
        .Telegram?.WebApp;
      if (!tg?.BackButton) {
        // SDK ещё не загрузился (грузится в layout) — ждём до ~5с.
        if (tries++ < 25) setTimeout(wire, 200);
        return;
      }
      bb = tg.BackButton;
      bb.onClick(onClick);
      if (pathname && pathname !== "/") bb.show();
      else bb.hide();
    };
    wire();
    return () => {
      cancelled = true;
      if (bb) bb.offClick(onClick);
    };
  }, [pathname, router]);

  return null;
}
