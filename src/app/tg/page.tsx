"use client";

// §5.9 — Telegram Mini App: точка входа. Telegram открывает эту страницу в
// webview и даёт window.Telegram.WebApp.initData (подписанный). Мы шлём initData
// на /api/tg-auth, там проверяют подпись и ставят onyx_session cookie — после
// чего все обычные страницы сайта работают внутри Telegram (поиск/продажа/бронь).
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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

async function runTgAuth(
  setState: (s: State) => void,
  router: { push: (href: string) => void },
  signal: { cancelled: boolean },
): Promise<void> {
  const tg = (
    globalThis as unknown as { Telegram?: { WebApp?: TgWebApp } }
  ).Telegram?.WebApp;
  tg?.ready?.();
  tg?.expand?.();
  const initData = tg?.initData ?? "";
  if (!initData) {
    if (!signal.cancelled) setState({ kind: "outside" });
    return;
  }
  try {
    const r = await fetch("/api/tg-auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData }),
    });
    const data = (await r.json()) as { ok: boolean; reason?: string };
    if (signal.cancelled) return;
    if (data.ok) {
      // Клиентская навигация (не reload) — сохраняет контекст Telegram WebApp,
      // чтобы BackButton и др. работали на всех страницах внутри Telegram.
      router.push("/");
      return;
    }
    setState({ kind: "error", reason: data.reason ?? "auth" });
  } catch {
    if (!signal.cancelled) setState({ kind: "error", reason: "network" });
  }
}

export default function TgMiniApp() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const router = useRouter();
  // Effect va Script onLoad bir xil cancel signal — unmount'da setState yo'q.
  const authSignalRef = useRef({ cancelled: false });

  useEffect(() => {
    // Agar SDK allaqachon yuklangan (qayta render) — auth ni ishga tushiramiz.
    // setState effect body ichida SINXRON chaqirilmasin: avval microtask/await,
    // keyin tashqi tizim (TG SDK / fetch) javobida setState.
    const signal = authSignalRef.current;
    signal.cancelled = false;

    const w = globalThis as unknown as { Telegram?: { WebApp?: TgWebApp } };
    if (!w.Telegram?.WebApp) {
      return () => {
        signal.cancelled = true;
      };
    }

    void (async () => {
      await Promise.resolve(); // sync setState-in-effect dan qochish
      if (signal.cancelled) return;
      await runTgAuth(setState, router, signal);
    })();
    return () => {
      signal.cancelled = true;
    };
  }, [router]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-sm flex-col items-center justify-center gap-3 p-6 text-center">
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="afterInteractive"
        onLoad={() => {
          const signal = authSignalRef.current;
          if (signal.cancelled) return;
          void runTgAuth(setState, router, signal);
        }}
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
