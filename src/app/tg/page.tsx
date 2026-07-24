"use client";

// §5.9 — Telegram Mini App: точка входа. Telegram открывает эту страницу в
// webview и даёт window.Telegram.WebApp.initData (подписанный). Мы шлём initData
// на /api/tg-auth, там проверяют подпись и ставят onyx_session cookie — после
// чего все обычные страницы сайта работают внутри Telegram (поиск/продажа/бронь).
import { useEffect, useState } from "react";
import Script from "next/script";

type State =
  | { kind: "loading" }
  | { kind: "outside" } // открыто не в Telegram
  | { kind: "error"; reason: string };

interface TgWebApp {
  initData?: string;
  ready?: () => void;
  expand?: () => void;
}

export default function TgMiniApp() {
  const [state, setState] = useState<State>({ kind: "loading" });

  async function authenticate() {
    const tg = (
      globalThis as unknown as { Telegram?: { WebApp?: TgWebApp } }
    ).Telegram?.WebApp;
    tg?.ready?.();
    tg?.expand?.();
    const initData = tg?.initData ?? "";
    if (!initData) {
      setState({ kind: "outside" });
      return;
    }
    try {
      const r = await fetch("/api/tg-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      });
      const data = (await r.json()) as { ok: boolean; reason?: string };
      if (data.ok) {
        window.location.href = "/";
        return;
      }
      setState({ kind: "error", reason: data.reason ?? "auth" });
    } catch {
      setState({ kind: "error", reason: "network" });
    }
  }

  useEffect(() => {
    // Если SDK уже загружен (повторный рендер) — сразу пробуем.
    const w = globalThis as unknown as { Telegram?: { WebApp?: TgWebApp } };
    if (w.Telegram?.WebApp) void authenticate();
  }, []);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-sm flex-col items-center justify-center gap-3 p-6 text-center">
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="afterInteractive"
        onLoad={() => void authenticate()}
      />
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
        Onyx
      </p>
      {state.kind === "loading" && (
        <p className="text-base text-ink/70">Входим через Telegram…</p>
      )}
      {state.kind === "outside" && (
        <p className="text-base text-ink/70">
          Откройте эту страницу через бота Onyx в Telegram (кнопка меню
          «Открыть склад»).
        </p>
      )}
      {state.kind === "error" && (
        <p className="text-base text-danger">
          {state.reason === "not_registered"
            ? "Вас нет в списке сотрудников. Нажмите /start в боте и дождитесь одобрения."
            : "Не удалось войти. Попробуйте ещё раз позже."}
        </p>
      )}
    </main>
  );
}
