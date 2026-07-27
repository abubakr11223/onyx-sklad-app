"use client";

// TZ №8 v2 §8.3 — `prefers-reduced-motion: reduce` kuzatuvi. Client-only:
// SSR'da har doim `false` qaytadi (hydration mos kelishi uchun), mount'dan keyin
// media query'ni tekshirib true'ga o'tishi mumkin. Kuzatuvchi (`change` event)
// tayinlanadi — foydalanuvchi jarayonda A11y sozlamasini yoqsa ham sfera darhol
// o'chib statik logo'ga o'tadi.
import { useEffect, useState } from "react";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    // Modern brauzerlar `addEventListener`, eski Safari `addListener`.
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    } else {
      // Eski Safari yo'li — @ts-ignore olib qo'ymaymiz, defensive.
      const legacy = mql as unknown as {
        addListener: (fn: (e: MediaQueryListEvent) => void) => void;
        removeListener: (fn: (e: MediaQueryListEvent) => void) => void;
      };
      legacy.addListener(onChange);
      return () => legacy.removeListener(onChange);
    }
  }, []);
  return reduced;
}
