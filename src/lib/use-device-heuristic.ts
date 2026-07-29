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
//
// Pattern: useSyncExternalStore — getServerSnapshot=false (hydration), client
// getSnapshot navigator'ni o'qiydi. Obuna yo'q (qiymat runtime'da o'zgarmaydi).
import { useSyncExternalStore } from "react";

interface NavigatorMemoryExt extends Navigator {
  deviceMemory?: number;
}

function computeIsWeak(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as NavigatorMemoryExt;
  const mem = nav.deviceMemory;
  const cores = nav.hardwareConcurrency;
  const memWeak = typeof mem === "number" && mem <= 4;
  const coreWeak = typeof cores === "number" && cores <= 4;
  return memWeak || coreWeak;
}

function subscribe(onChange: () => void): () => void {
  // Statik heuristika — runtime'da o'zgarmaydi. onChange saqlanadi (API shakli).
  void onChange;
  return () => {};
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * Client mount'dan keyin bir marta hisoblanadi. SSR (`false`) → hydration mos.
 * Zaif deb aniqlansa, ota-komponent (LoginPageClient) Canvas'ni umuman
 * render qilmasdan darhol statik logo'ga o'tadi.
 */
export function useIsWeakDevice(): boolean {
  return useSyncExternalStore(subscribe, computeIsWeak, getServerSnapshot);
}
