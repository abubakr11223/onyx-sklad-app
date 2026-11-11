"use client";

// TZ №8 v2 — /login redizayn client wrapper.
// Server component (page.tsx) auth check + env'ni bajaradi, keyin bu client'ga
// flag'lar bilan render qiladi. Bu qatlam FAQAT vizual: dark bg + radial
// gradient + oq karta + Framer Motion + 3D sfera (dynamic import, ssr:false).
// ТЗ №20 «Оникс» (2026-11-11): fon — onyx-950 tekis (gradient taqiqlangan),
// forma — marble karta, asosiy tugma — qora (ink), fokus — asal (honey).
// Shrift — IBM Plex Sans (--font-plex-sans). Chap yarmida haqiqiy oniks plita
// fotosi (§6.3) — rasm egadan kutilmoqda; hozircha logotip-sfera turadi.
//
// XAVFSIZLIK: loginWithPassword — "use server" action, client'dan `<form action={...}>`
// orqali chaqiriladi (Next.js buni qo'llab-quvvatlaydi). Field/Button UI komponentlari
// dark tema uchun mos EMAS, shuning uchun inline styled JSX ishlatiladi.

import { motion, MotionConfig } from "framer-motion";
import dynamic from "next/dynamic";
import { useState } from "react";
import { loginWithPassword } from "./actions";
import { StaticLogo } from "@/components/login/StaticLogo";
import { useIsWeakDevice } from "@/lib/use-device-heuristic";
import { useReducedMotion } from "@/lib/use-reduced-motion";

// TZ §11 / §6 — 3D sfera FAQAT client'da, dynamic import, ssr:false. `loading`
// darhol StaticLogo (breathing variant) — 3D chunk yuklanguncha ham SLOT to'la
// bo'ladi (layout shift yo'q, forma darhol interaktiv qoladi).
const LogoSphere3D = dynamic(
  () => import("@/components/login/LogoSphere3D"),
  {
    ssr: false,
    loading: () => <StaticLogo variant="breathing" size={400} />,
  },
);

interface LoginPageClientProps {
  next: string;
  loginError: boolean;
  /** Аудит 2026-08-10 — превышено число попыток (пароль мог быть верным). */
  throttledError?: boolean;
  magicError: boolean;
  tgDeepLink: string | null;
}

// Framer Motion easing — TZ §7.1 (out-expo cubic bezier).
const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

export function LoginPageClient({
  next,
  loginError,
  throttledError = false,
  magicError,
  tgDeepLink,
}: LoginPageClientProps) {
  // TZ §8 fallback zanjiri:
  //  1) prefers-reduced-motion → statik logo, animatsiya YO'Q.
  //  2) statik zaif-qurilma (deviceMemory/hardwareConcurrency ≤4) → statik + glow.
  //  3) dinamik FPS probe (Canvas ichida) → onLowFps ishlab ketsa lowFps=true.
  //  4) hech nima ishlamasa → 3D sfera.
  const reducedMotion = useReducedMotion();
  const isWeakDevice = useIsWeakDevice();
  const [lowFps, setLowFps] = useState(false);

  // Fallback qaror: reduced-motion — eng qattiq (hatto glow ham yo'q).
  // Weak-device / low-fps — statik + CSS glow (yumshoq nafas oluvchi shu'la).
  // Aks holda — 3D sfera dynamic import bilan (loading fallback = breathing SVG).
  const shouldRender3D = !reducedMotion && !isWeakDevice && !lowFps;
  const staticVariant: "static" | "glow" = reducedMotion ? "static" : "glow";

  return (
    <MotionConfig reducedMotion={reducedMotion ? "always" : "never"}>
    <main
      className="login-root"
    >
      {/* 3D sfera slot — fallback zanjiri (TZ §8):
          reduced-motion → static (animatsiya yo'q)
          weak-device / low-FPS → static glow
          aks holda → dynamic 3D (loading fallback = breathing SVG)
          Motion wrapper reduced-motion'da opacity/scale animatsiyasidan
          voz kechadi (framer-motion o'zi `useReducedMotion`ni hurmat qiladi
          — biz initial=animate qilib qo'yamiz). */}
      <motion.div
        className="login-logo-slot"
        initial={reducedMotion ? false : { opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={
          reducedMotion
            ? { duration: 0 }
            : { duration: 0.8, ease: EASE_OUT_EXPO }
        }
      >
        {shouldRender3D ? (
          <LogoSphere3D size={400} onLowFps={() => setLowFps(true)} />
        ) : (
          <StaticLogo variant={staticVariant} size={400} />
        )}
      </motion.div>

      {/* Wordmark: "ONYX" + "stones boutique" (Inter, oq) */}
      <motion.header
        className="login-header"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2, ease: EASE_OUT_EXPO }}
      >
        <h1 className="login-wordmark">ONYX</h1>
        <p className="login-tag">stones boutique</p>
      </motion.header>

      {/* Oq karta */}
      <motion.section
        className="login-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.3, ease: EASE_OUT_EXPO }}
      >
        {loginError && (
          <div className="login-alert" role="alert">
            Неверный логин или пароль.
          </div>
        )}
        {throttledError && (
          <div className="login-alert" role="alert">
            Слишком много попыток входа. Подождите 15 минут и попробуйте снова —
            пароль менять не нужно.
          </div>
        )}
        {magicError && (
          <div className="login-alert" role="alert">
            Ссылка для входа недействительна или устарела. Запросите новую в Telegram.
          </div>
        )}

        <form action={loginWithPassword} className="login-form">
          <input type="hidden" name="next" value={next} />

          <label className="login-field">
            <span className="login-label">Логин (email)</span>
            <input
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="username"
              required
              aria-invalid={loginError ? true : undefined}
              className="login-input"
            />
          </label>

          <label className="login-field">
            <span className="login-label">Пароль</span>
            <input
              id="login-password"
              name="password"
              type="password"
              placeholder="Пароль"
              autoComplete="current-password"
              required
              aria-invalid={loginError ? true : undefined}
              className="login-input"
            />
          </label>

          <button type="submit" className="login-button-primary">
            Войти
          </button>
        </form>

        <div className="login-divider">
          <span className="login-divider-line" />
          <span className="login-divider-text">складчик — через Telegram</span>
          <span className="login-divider-line" />
        </div>

        {tgDeepLink ? (
          <a href={tgDeepLink} className="login-button-secondary">
            Войти через Telegram
          </a>
        ) : (
          <p className="login-tg-hint">Откройте бота и отправьте /login</p>
        )}
      </motion.section>

      {/* Barcha CSS — faqat shu route uchun (scoped inline <style>). Global
          globals.css tegilmagan (TZ §3 talabidek). */}
      <style>{`
        :root {
          --login-bg-base: var(--color-onyx-950);
          --login-accent: var(--color-ink);
          --login-accent-hover: var(--color-onyx-800);
          --login-card-bg: var(--color-marble);
          --login-card-border: var(--color-line);
          --login-on-dark: #FFFFFF;
          --login-on-dark-muted: var(--color-side-text);
          --login-text-primary: var(--color-ink);
          --login-text-muted: var(--color-ink-2);
          --login-input-bg: var(--color-marble);
          --login-input-border: var(--color-line-strong);
          --login-input-border-focus: var(--color-honey);
          --login-error: var(--color-carnelian);
        }

        .login-root {
          position: relative;
          min-height: 100dvh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 24px;
          padding: 24px 16px;
          background: var(--login-bg-base);
          color: var(--login-on-dark);
          font-family: var(--font-plex-sans), system-ui, sans-serif;
          /* Faqat gorizontal kesish: past ekranlarda (≈720px) forma pastga
             tushsa, sahifa vertikal aylanishi (scroll) SHART — tugma
             ko'rinmay qolmasin. */
          overflow-x: hidden;
        }
        .login-logo-slot {
          position: relative;
          z-index: 1;
          /* Slot kengligi ekranga bog'langan (aks holda u bolasining 400px
             qat'iy kengligiga cho'ziladi va tor telefonda gorizontal chiqib
             ketadi — max-width: 100% ham ayni o'sha 400px ga hisoblanardi). */
          width: 100%;
          height: 48vh;
          max-height: 440px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        /* Logo (3D wrapper YOKI statik SVG wrapper) o'zining inline
           width/height = size (px) bilan keladi. Slot qisqarganda (past yoki
           tor ekran) shu qat'iy quti slotdan CHIQIB ketardi — sfera yuqoridan
           kesilib, wordmark ustiga tushardi. max-width/max-height inline
           width/height'ni bosib o'tadi (boshqa xossalar), shuning uchun logo
           endi HAR DOIM slot ichida qoladi. */
        .login-logo-slot > div {
          max-width: 100%;
          max-height: 100%;
          min-width: 0;
        }
        /* StaticLogo <svg width={size} height={size}> — presentation
           atributlari CSS bilan bosiladi; viewBox + preserveAspectRatio
           sferani markazda, proporsiyani buzmasdan kichraytiradi.
           r3f <Canvas> allaqachon o'z konteynerini 100% kuzatadi. */
        .login-logo-slot svg {
          width: 100%;
          height: 100%;
        }
        @media (max-width: 640px) {
          .login-logo-slot { height: 38vh; max-height: 320px; }
        }

        .login-header {
          position: relative;
          z-index: 1;
          text-align: center;
          margin-top: -8px;
        }
        .login-wordmark {
          font-weight: 600;
          font-size: 44px;
          letter-spacing: 0.12em;
          color: var(--login-on-dark);
          margin: 0;
        }
        .login-tag {
          font-weight: 500;
          font-size: 11px;
          letter-spacing: 0.4em;
          text-transform: uppercase;
          color: var(--login-on-dark-muted);
          margin: 4px 0 0 0;
        }
        @media (max-width: 640px) {
          .login-wordmark { font-size: 36px; }
          .login-tag { font-size: 10px; }
        }

        .login-card {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 420px;
          padding: 40px 32px;
          background: var(--login-card-bg);
          color: var(--login-text-primary);
          border: 1px solid var(--login-card-border);
          border-radius: 10px;
          box-shadow: none;
        }
        @media (max-width: 640px) {
          .login-card { padding: 28px 20px; }
        }
        /* Past ekranlar (masalan 1280x720 laptop): sfera va oraliqlarni
           qisqartiramiz — email + parol + «Войти» birinchi ekranga sig'sin.
           MUHIM: bu blok BARCHA (max-width: 640px) bloklaridan KEYIN
           turadi va (min-width: 641px) bilan cheklangan — telefon (≤640px)
           sozlamalari (38vh slot, 36px wordmark, 28px 20px karta) buzilmasin.
           Ikkala shart ham ataylab: shartlar kesishmaydi, tartib esa kelajakda
           qo'shiladigan qoidalar uchun ham xavfsiz. */
        @media (max-height: 760px) and (min-width: 641px) {
          .login-root { gap: 12px; padding: 16px; }
          .login-logo-slot { height: 26vh; max-height: 200px; }
          .login-wordmark { font-size: 32px; }
          .login-card { padding: 24px 28px; }
        }

        .login-alert {
          padding: 10px 14px;
          margin-bottom: 16px;
          border-radius: 6px;
          background: var(--color-carnelian-bg);
          border: 1px solid var(--color-carnelian-line);
          color: var(--login-error);
          font-size: 14px;
        }

        .login-form { display: flex; flex-direction: column; gap: 16px; }
        .login-field { display: flex; flex-direction: column; gap: 6px; }
        .login-label {
          font-size: 12px;
          font-weight: 500;
          color: var(--login-text-muted);
        }
        .login-input {
          width: 100%;
          padding: 12px 14px;
          font-size: 15px;
          background: var(--login-input-bg);
          border: 1px solid var(--login-input-border);
          border-radius: 6px;
          color: var(--login-text-primary);
          min-height: 44px;
          box-sizing: border-box;
          transition: border-color 0.15s ease-out;
          outline: none;
        }
        .login-input::placeholder { color: var(--color-ink-3); }
        .login-input:focus {
          border-color: var(--login-input-border-focus);
          box-shadow: 0 0 0 3px var(--color-honey-soft);
        }
        .login-input[aria-invalid="true"] {
          border-color: var(--login-error);
        }

        .login-button-primary {
          margin-top: 8px;
          padding: 13px 20px;
          border: none;
          border-radius: 6px;
          min-height: 44px;
          background: var(--login-accent);
          color: #FFFFFF;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.15s ease-out;
        }
        @media (hover: hover) and (pointer: fine) {
          .login-button-primary:hover { background: var(--login-accent-hover); }
        }
        .login-button-primary:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--color-honey-soft), 0 0 0 1px var(--color-honey); }
        .login-button-primary:disabled { opacity: 0.4; cursor: not-allowed; }

        .login-divider {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 20px 0 14px;
        }
        .login-divider-line {
          flex: 1;
          height: 1px;
          background: var(--login-card-border);
        }
        .login-divider-text {
          font-size: 12px;
          color: var(--login-text-muted);
        }

        .login-button-secondary {
          display: block;
          width: 100%;
          padding: 12px 20px;
          text-align: center;
          border: 1px solid var(--login-input-border);
          border-radius: 6px;
          background: var(--color-marble);
          color: var(--login-text-primary);
          font-size: 14px;
          font-weight: 500;
          text-decoration: none;
          box-sizing: border-box;
          transition: border-color 0.15s ease-out, background 0.15s ease-out;
        }
        @media (hover: hover) and (pointer: fine) {
          .login-button-secondary:hover {
            background: var(--color-stone-100);
          }
        }
        .login-tg-hint {
          text-align: center;
          font-size: 14px;
          color: var(--login-text-muted);
        }

        @media (prefers-reduced-motion: reduce) {
          .login-button-primary:hover,
          .login-button-secondary:hover {
            transform: none !important;
            box-shadow: none !important;
          }
        }
      `}</style>
    </main>
    </MotionConfig>
  );
}
