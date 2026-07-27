"use client";

// TZ №8 v2 — /login redizayn client wrapper.
// Server component (page.tsx) auth check + env'ni bajaradi, keyin bu client'ga
// flag'lar bilan render qiladi. Bu qatlam FAQAT vizual: dark bg + radial
// gradient + shisha karta + Framer Motion. 3D sfera S3'da qo'shiladi (dynamic
// import, ssr:false). S2 da statik logo turadi.
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
import { loraWordmark, montserratTag } from "./login-fonts";

// TZ §11 / §6 — 3D sfera FAQAT client'da, dynamic import, ssr:false. `loading`
// darhol StaticLogo (breathing variant) — 3D chunk yuklanguncha ham SLOT to'la
// bo'ladi (layout shift yo'q, forma darhol interaktiv qoladi).
const LogoSphere3D = dynamic(
  () => import("@/components/login/LogoSphere3D"),
  {
    ssr: false,
    loading: () => <StaticLogo variant="breathing" size={280} />,
  },
);

interface LoginPageClientProps {
  next: string;
  loginError: boolean;
  magicError: boolean;
  tgDeepLink: string | null;
}

// Framer Motion easing — TZ §7.1 (out-expo cubic bezier).
const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

export function LoginPageClient({
  next,
  loginError,
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
      className={`${loraWordmark.variable} ${montserratTag.variable} login-root`}
    >
      {/* Radial gradient overlay — TZ §3 */}
      <div className="login-bg-radial" aria-hidden />

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
          <LogoSphere3D size={280} onLowFps={() => setLowFps(true)} />
        ) : (
          <StaticLogo variant={staticVariant} size={280} />
        )}
      </motion.div>

      {/* Wordmark: "ONYX" (Lora, gold gradient) + "stones boutique" (Montserrat) */}
      <motion.header
        className="login-header"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2, ease: EASE_OUT_EXPO }}
      >
        <h1 className="login-wordmark">ONYX</h1>
        <p className="login-tag">stones boutique</p>
      </motion.header>

      {/* Shisha karta */}
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
          --login-bg-base: #0B0B0D;
          --login-bg-radial: radial-gradient(ellipse 90% 70% at 50% 25%, #241C10 0%, #14100A 45%, #0B0B0D 80%);
          --login-gold-main: #C9A55C;
          --login-gold-hi-1: #E9CF8F;
          --login-gold-hi-2: #F5E7C0;
          --login-gold-glow: rgba(233, 207, 143, 0.35);
          --login-card-bg: rgba(28, 22, 14, 0.72);
          --login-card-border: rgba(233, 207, 143, 0.28);
          --login-card-blur: 24px;
          --login-text-primary: #F5F0E8;
          --login-text-muted: rgba(245, 240, 232, 0.6);
          --login-input-bg: rgba(20, 16, 10, 0.55);
          --login-input-border: rgba(233, 207, 143, 0.28);
          --login-input-border-focus: #E9CF8F;
          --login-error: #FF6B6B;
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
          color: var(--login-text-primary);
          overflow: hidden;
        }
        .login-bg-radial {
          position: absolute;
          inset: 0;
          background: var(--login-bg-radial);
          pointer-events: none;
          z-index: 0;
        }

        .login-logo-slot {
          position: relative;
          z-index: 1;
          height: 40vh;
          max-height: 320px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        @media (max-width: 640px) {
          .login-logo-slot { height: 32vh; max-height: 240px; }
        }

        .login-header {
          position: relative;
          z-index: 1;
          text-align: center;
          margin-top: -8px;
        }
        .login-wordmark {
          font-family: var(--font-lora-wordmark), Georgia, serif;
          font-weight: 400;
          font-size: 44px;
          letter-spacing: 0.15em;
          background: linear-gradient(135deg, #E9CF8F 0%, #C9A55C 50%, #F5E7C0 100%);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          margin: 0;
          filter: drop-shadow(0 0 24px var(--login-gold-glow));
        }
        .login-tag {
          font-family: var(--font-montserrat-tag), Arial, sans-serif;
          font-weight: 300;
          font-size: 11px;
          letter-spacing: 0.4em;
          text-transform: uppercase;
          color: var(--login-text-muted);
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
          border: 1px solid var(--login-card-border);
          border-radius: 20px;
          backdrop-filter: blur(var(--login-card-blur));
          -webkit-backdrop-filter: blur(var(--login-card-blur));
          box-shadow: 0 24px 70px rgba(0, 0, 0, 0.7), 0 0 40px rgba(233, 207, 143, 0.08), inset 0 1px 0 rgba(233, 207, 143, 0.12);
        }
        @media (max-width: 640px) {
          .login-card { padding: 28px 20px; }
        }

        .login-alert {
          padding: 10px 14px;
          margin-bottom: 16px;
          border-radius: 10px;
          background: rgba(255, 107, 107, 0.08);
          border: 1px solid rgba(255, 107, 107, 0.25);
          color: var(--login-error);
          font-size: 14px;
        }

        .login-form { display: flex; flex-direction: column; gap: 16px; }
        .login-field { display: flex; flex-direction: column; gap: 6px; }
        .login-label {
          font-size: 12px;
          color: var(--login-text-muted);
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .login-input {
          width: 100%;
          padding: 12px 14px;
          font-size: 15px;
          background: var(--login-input-bg);
          border: 1px solid var(--login-input-border);
          border-radius: 10px;
          color: var(--login-text-primary);
          transition: border-color 0.2s ease-out, box-shadow 0.2s ease-out;
          outline: none;
        }
        .login-input::placeholder { color: rgba(245, 240, 232, 0.3); }
        .login-input:focus {
          border-color: var(--login-input-border-focus);
          box-shadow: 0 0 0 3px rgba(245, 217, 142, 0.15);
        }
        .login-input[aria-invalid="true"] {
          border-color: var(--login-error);
        }

        .login-button-primary {
          margin-top: 8px;
          padding: 13px 20px;
          border: none;
          border-radius: 10px;
          background: linear-gradient(135deg, var(--login-gold-hi-1) 0%, var(--login-gold-main) 100%);
          color: #0B0B0D;
          font-size: 15px;
          font-weight: 500;
          letter-spacing: 0.02em;
          cursor: pointer;
          transition: transform 0.2s ease-out, box-shadow 0.2s ease-out;
        }
        @media (hover: hover) and (pointer: fine) {
          .login-button-primary:hover {
            transform: scale(1.02);
            box-shadow: 0 8px 24px rgba(245, 217, 142, 0.25);
          }
        }
        .login-button-primary:active { transform: scale(0.98); }
        .login-button-primary:disabled { opacity: 0.6; cursor: not-allowed; }

        .login-divider {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 20px 0 14px;
        }
        .login-divider-line {
          flex: 1;
          height: 1px;
          background: rgba(245, 217, 142, 0.12);
        }
        .login-divider-text {
          font-size: 11px;
          color: var(--login-text-muted);
          letter-spacing: 0.05em;
        }

        .login-button-secondary {
          display: block;
          width: 100%;
          padding: 12px 20px;
          text-align: center;
          border: 1px solid var(--login-input-border);
          border-radius: 10px;
          background: transparent;
          color: var(--login-text-primary);
          font-size: 14px;
          text-decoration: none;
          transition: border-color 0.2s ease-out, background 0.2s ease-out;
        }
        @media (hover: hover) and (pointer: fine) {
          .login-button-secondary:hover {
            border-color: var(--login-input-border-focus);
            background: rgba(245, 217, 142, 0.04);
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
