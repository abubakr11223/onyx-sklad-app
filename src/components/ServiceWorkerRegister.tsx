"use client";

// §7/§8 — регистрация service worker (офлайн-загрузка оболочки + офлайн-страница).
// SW минимальный и безопасный (см. public/sw.js): навигации network-first, не
// кэширует динамику/мутации — не «брикает» приложение.
import { useEffect } from "react";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (
      typeof navigator === "undefined" ||
      !("serviceWorker" in navigator) ||
      process.env.NODE_ENV !== "production"
    ) {
      return;
    }
    // Регистрируем после загрузки, чтобы не мешать первому рендеру.
    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("[sw] регистрация не удалась:", err);
      });
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);
  return null;
}
