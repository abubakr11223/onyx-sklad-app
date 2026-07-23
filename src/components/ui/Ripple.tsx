"use client";

// Глобальный ripple: один делегированный слушатель на документ. Любой элемент
// с классом `.onyx-btn` (все кнопки/ссылки-кнопки — Button/buttonClass) получает
// волну из точки нажатия. Ноль изменений в серверных компонентах: они лишь несут
// класс. Уважает prefers-reduced-motion. Монтируется один раз в layout.
import { useEffect } from "react";

export default function Ripple() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    function onPointerDown(e: PointerEvent) {
      const target = e.target as HTMLElement | null;
      const host = target?.closest?.(".onyx-btn") as HTMLElement | null;
      if (!host || host.hasAttribute("disabled")) return;

      const rect = host.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const span = document.createElement("span");
      span.className = "onyx-ripple";
      span.style.width = span.style.height = `${size}px`;
      span.style.left = `${e.clientX - rect.left - size / 2}px`;
      span.style.top = `${e.clientY - rect.top - size / 2}px`;
      host.appendChild(span);

      const cleanup = () => span.remove();
      span.addEventListener("animationend", cleanup);
      window.setTimeout(cleanup, 800);
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  return null;
}
