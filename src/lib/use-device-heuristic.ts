"use client";

// TZ №8 v2 §8.2a — STATIK zaif-qurilma tekshiruvi (mount'gacha, sinxron).
// Canvas umuman mount bo'lmasligi uchun — "bir zumga ko'rinish" muammosini
// oldini oladi. Dinamik FPS probe — Canvas ichida (LogoSphere3D `onLowFps`).
//
// Heuristika:
//  • deviceMemory <= 4 → weak (undefined bu shartni ISHGA TUSHIRMAYDI — modern
//    desktop'lar undefined qaytarishi mumkin, ularni "weak" deb belgilash yolg'on-
//    yashiq bo'lardi).
//  • hardwareConcurrency <= 4 → weak.
// SSR'da undefined navigatorga tegmasin — server render'da har doim `false`.
import { useEffect, useState } from "react";

interface NavigatorMemoryExt extends Navigator {
  deviceMemory?: number;
}

/**
 * Client mount'dan keyin bir marta hisoblanadi. SSR (`false`) → hydration mos.
 * Zaif deb aniqlansa, ota-komponent (LoginPageClient) Canvas'ni umuman
 * render qilmasdan darhol statik logo'ga o'tadi.
 */
export function useIsWeakDevice(): boolean {
  const [weak, setWeak] = useState(false);
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const nav = navigator as NavigatorMemoryExt;
    const mem = nav.deviceMemory;
    const cores = nav.hardwareConcurrency;
    const memWeak = typeof mem === "number" && mem <= 4;
    const coreWeak = typeof cores === "number" && cores <= 4;
    if (memWeak || coreWeak) setWeak(true);
  }, []);
  return weak;
}
