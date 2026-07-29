"use client";

// TZ №8 v2 §8.3 — `prefers-reduced-motion: reduce` kuzatuvi. Client-only:
// SSR'da har doim `false` qaytadi (hydration mos kelishi uchun), mount'dan keyin
// media query'ni tekshirib true'ga o'tishi mumkin. Kuzatuvchi (`change` event)
// tayinlanadi — foydalanuvchi jarayonda A11y sozlamasini yoqsa ham sfera darhol
// o'chib statik logo'ga o'tadi.
//
// Pattern: useSyncExternalStore (React tavsiyasi media query uchun) —
// effect ichida setState o'rniga tashqi store obuna.
import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) {
    return () => {};
  }
  const mql = window.matchMedia(QUERY);
  const handler = () => onChange();
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }
  // Eski Safari yo'li.
  const legacy = mql as unknown as {
    addListener: (fn: () => void) => void;
    removeListener: (fn: () => void) => void;
  };
  legacy.addListener(handler);
  return () => legacy.removeListener(handler);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
