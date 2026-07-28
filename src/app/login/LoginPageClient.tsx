"use client";

// TZ №8 v3 — /login layout (referens: onyx_login_3d_logo_preview.html).
// Sfera FON sifatida absolute inset:0 to'la Canvas'da aylanadi; wordmark +
// karta uning ustidan z-index bilan ko'rinadi. Fon rangi #0B0B0D (aynan
// referens). Kartochka fon rgba(20,18,14,.55), tashqi oltin box-shadow.

import { motion, MotionConfig } from "framer-motion";
import dynamic from "next/dynamic";
import { useState } from "react";
import { loginWithPassword } from "./actions";
import { StaticLogo } from "@/components/login/StaticLogo";
import { useIsWeakDevice } from "@/lib/use-device-heuristic";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { loraWordmark, montserratTag } from "./login-fonts";

// 3D sfera FAQAT client'da, dynamic import (SSR off). Fallback — statik SVG.
// Fullscreen: LogoSphere3D o'zi parent'ga inset:0 bilan yopishadi.
const LogoSphere3D = dynamic(() => import("@/components/login/LogoSphere3D"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <StaticLogo variant="breathing" size={520} />
    </div>
  ),
});

interface LoginPageClientProps {
  next: string;
  loginError: boolean;
  magicError: boolean;
  tgDeepLink: string | null;
}

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

export function LoginPageClient({
  next,
  loginError,
  magicError,
  tgDeepLink,
}: LoginPageClientProps) {
  // Framer motion accessibility uchun reducedMotion'ni bilamiz, lekin 3D
  // sferaning o'zi hero-vizual — foydalanuvchi so'ragan (referens'ga aynan
  // moslashtirilgan). Shu sabab sferani `reducedMotion` bekor qilmaydi.
  // Faqat haqiqiy zaif qurilma (mem/cores) va FPS <20 (mustahkam signal)
  // 3D'ni to'xtatadi.
  const reducedMotion = useReducedMotion();
  const isWeakDevice = useIsWeakDevice();
  const [lowFps, setLowFps] = useState(false);

  const shouldRender3D = !isWeakDevice && !lowFps;
  const staticVariant: "static" | "glow" = reducedMotion ? "static" : "glow";

  return (
    <MotionConfig reducedMotion={reducedMotion ? "always" : "never"}>
      <main
        className={`${loraWordmark.variable} ${montserratTag.variable} login-root`}
      >
        {/* Sfera fon: butun ekranni to'ldiradi (referens'dagi kabi
            `canvas absolute inset:0`). Fallback statik SVG ham fon o'lchamida
            markazlanadi. */}
        <div className="login-bg-3d" aria-hidden>
          {shouldRender3D ? (
            <LogoSphere3D onLowFps={() => setLowFps(true)} />
          ) : (
            <div className="login-bg-static">
              <StaticLogo variant={staticVariant} size={520} />
            </div>
          )}
        </div>

        {/* Kontent — sfera ustidan */}
        <div className="login-content">
          <motion.header
            className="login-header"
            initial={reducedMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: EASE_OUT_EXPO }}
          >
            <h1 className="login-wordmark">ONYX</h1>
            <p className="login-tag">stones boutique</p>
          </motion.header>

          <motion.section
            className="login-card"
            initial={reducedMotion ? false : { opacity: 0, y: 20 }}
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
        </div>

        <style>{`
          :root {
            --login-bg-base: #0B0B0D;
            --login-gold-main: #C9A55C;
            --login-gold-hi-1: #E9CF8F;
            --login-gold-hi-2: #F5E7C0;
            --login-gold-glow: rgba(233, 207, 143, 0.35);
            --login-card-bg: rgba(20, 18, 14, 0.55);
            --login-card-border: rgba(201, 165, 92, 0.4);
            --login-card-blur: 12px;
            --login-text-primary: #F5F0E8;
            --login-text-muted: rgba(245, 240, 232, 0.6);
            --login-input-bg: rgba(255, 255, 255, 0.04);
            --login-input-border: rgba(201, 165, 92, 0.4);
            --login-input-border-focus: #C9A55C;
            --login-error: #FF6B6B;
          }

          .login-root {
            position: relative;
            min-height: 100dvh;
            background: var(--login-bg-base);
            color: var(--login-text-primary);
            overflow: hidden;
          }

          /* Sfera fon — butun ekran (referens: canvas absolute inset:0) */
          .login-bg-3d {
            position: absolute;
            inset: 0;
            z-index: 0;
            pointer-events: none;
          }
          .login-bg-static {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
          }

          /* Kontent ustidan */
          .login-content {
            position: relative;
            z-index: 2;
            min-height: 100dvh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 24px;
            padding: 40px 20px;
          }

          .login-header {
            text-align: center;
            /* Wordmark sfera markazi/pastida qolib ko'rinsin (referens'da kabi
               "ONYX" sfera ichidan chiqib turadi). */
            margin-top: 8vh;
          }
          .login-wordmark {
            font-family: var(--font-lora-wordmark), Georgia, serif;
            font-weight: 400;
            font-size: 44px;
            letter-spacing: 0.20em;
            padding-left: 0.20em;
            color: var(--login-gold-hi-1);
            text-shadow: 0 0 24px rgba(201, 165, 92, 0.45);
            margin: 0;
            line-height: 1;
          }
          .login-tag {
            font-family: var(--font-montserrat-tag), Arial, sans-serif;
            font-weight: 300;
            font-size: 11px;
            letter-spacing: 0.48em;
            padding-left: 0.48em;
            text-transform: uppercase;
            color: var(--login-gold-main);
            opacity: 0.85;
            margin: 8px 0 0 0;
          }
          @media (max-width: 640px) {
            .login-wordmark { font-size: 36px; }
            .login-tag { font-size: 10px; }
          }

          .login-card {
            width: 100%;
            max-width: 340px;
            padding: 22px 22px 24px;
            background: var(--login-card-bg);
            border: 1px solid var(--login-card-border);
            border-radius: 20px;
            backdrop-filter: blur(var(--login-card-blur));
            -webkit-backdrop-filter: blur(var(--login-card-blur));
            box-shadow: 0 0 60px rgba(201, 165, 92, 0.18);
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

          .login-form { display: flex; flex-direction: column; gap: 14px; }
          .login-field { display: flex; flex-direction: column; gap: 6px; }
          .login-label {
            font-size: 12px;
            color: #EFE7D4;
          }
          .login-input {
            width: 100%;
            padding: 11px 13px;
            font-size: 14px;
            background: var(--login-input-bg);
            border: 1px solid var(--login-input-border);
            border-radius: 10px;
            color: #F5F2EA;
            outline: none;
            transition: border-color 0.2s ease-out, box-shadow 0.2s ease-out;
          }
          .login-input::placeholder { color: rgba(245, 240, 232, 0.35); }
          .login-input:focus {
            border-color: var(--login-input-border-focus);
            box-shadow: 0 0 0 3px rgba(201, 165, 92, 0.18);
          }
          .login-input[aria-invalid="true"] {
            border-color: var(--login-error);
          }

          .login-button-primary {
            margin-top: 18px;
            padding: 13px;
            border: none;
            border-radius: 11px;
            background: linear-gradient(90deg, #A67C2E, #C9A55C);
            color: #1a1408;
            font-size: 15px;
            font-weight: 500;
            cursor: pointer;
            transition: transform 0.18s ease-out, box-shadow 0.18s ease-out;
            width: 100%;
          }
          @media (hover: hover) and (pointer: fine) {
            .login-button-primary:hover {
              transform: translateY(-1px);
              box-shadow: 0 6px 22px rgba(201, 165, 92, 0.4);
            }
          }
          .login-button-primary:active { transform: translateY(0); }
          .login-button-primary:disabled { opacity: 0.6; cursor: not-allowed; }

          .login-divider {
            display: flex;
            align-items: center;
            gap: 10px;
            margin: 16px 0 12px;
            color: #9a8f78;
            font-size: 11px;
          }
          .login-divider-line {
            flex: 1;
            height: 1px;
            background: rgba(201, 165, 92, 0.25);
          }
          .login-divider-text { white-space: nowrap; }

          .login-button-secondary {
            display: block;
            width: 100%;
            padding: 12px;
            text-align: center;
            border: 1px solid rgba(201, 165, 92, 0.45);
            border-radius: 11px;
            background: transparent;
            color: var(--login-gold-hi-1);
            font-size: 14px;
            font-weight: 500;
            text-decoration: none;
            transition: border-color 0.18s ease-out, background 0.18s ease-out;
          }
          @media (hover: hover) and (pointer: fine) {
            .login-button-secondary:hover {
              border-color: var(--login-gold-main);
              background: rgba(201, 165, 92, 0.08);
            }
          }
          .login-tg-hint {
            text-align: center;
            font-size: 13px;
            color: var(--login-text-muted);
            margin: 0;
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
