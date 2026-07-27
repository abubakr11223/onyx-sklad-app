// TZ №8 v2 §8.1 — statik SVG logo (3D fallback). Sfera bilan bir xil oltin
// palitrada: markazda #C9A55C to'lgan doira + 6 elliptik kontur (lenta-globus
// imitatsiyasi, TubeGeometry ekvivalenti). Rangi va o'lchami sfera bilan mos
// bo'lishi UCHUN Suspense/reduced-motion o'tishlarida "sakrash" bo'lmaydi.
//
// `variant`:
//  - "static": harakatsiz (reduced-motion, JS o'chirilgan).
//  - "glow": CSS box-shadow pulse animatsiyasi (zaif qurilma fallback).
//  - "breathing": opacity 0.4→0.8→0.4 (Suspense loading — 3D yuklanmoqda).

import type { CSSProperties } from "react";

interface StaticLogoProps {
  variant?: "static" | "glow" | "breathing";
  size?: number;
  ariaHidden?: boolean;
}

export function StaticLogo({
  variant = "static",
  size = 240,
  ariaHidden = true,
}: StaticLogoProps) {
  // 6 ta lenta — 3D dagi CatmullRomCurve inclination'ga mos (15°→90° qadam 15°).
  const bandRotations = [15, 30, 45, 60, 75, 90];
  const bandStyle: CSSProperties = {
    fill: "none",
    stroke: "url(#login-static-gold)",
    strokeWidth: 1.5,
    opacity: 0.65,
  };

  const wrapperStyle: CSSProperties = {
    width: size,
    height: size,
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  return (
    <div
      aria-hidden={ariaHidden}
      style={wrapperStyle}
      data-variant={variant}
      className={
        variant === "glow"
          ? "login-logo-glow-pulse"
          : variant === "breathing"
            ? "login-logo-breathing"
            : ""
      }
    >
      <svg
        viewBox="-100 -100 200 200"
        width={size}
        height={size}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <radialGradient id="login-static-gold" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="#F5E7C0" />
            <stop offset="50%" stopColor="#E9CF8F" />
            <stop offset="100%" stopColor="#C9A55C" />
          </radialGradient>
          <radialGradient id="login-static-core" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="#E9CF8F" stopOpacity="0.9" />
            <stop offset="70%" stopColor="#C9A55C" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#8B6A2E" stopOpacity="0.4" />
          </radialGradient>
        </defs>

        {/* Yumshoq halo */}
        <circle cx="0" cy="0" r="82" fill="#E9CF8F" opacity="0.06" />

        {/* Markaziy sfera imitatsiyasi (yumshoq gradient) */}
        <circle cx="0" cy="0" r="60" fill="url(#login-static-core)" opacity="0.35" />

        {/* 6 ta lenta — inclination bo'yicha aylantirilgan ellipslar */}
        {bandRotations.map((deg) => (
          <ellipse
            key={deg}
            cx="0"
            cy="0"
            rx="70"
            ry="24"
            transform={`rotate(${deg})`}
            style={bandStyle}
          />
        ))}

        {/* Ustki nur — highlight nuqtasi (metalness taassuroti) */}
        <circle cx="-18" cy="-22" r="8" fill="#F5E7C0" opacity="0.4" />
      </svg>

      {/* Anim CSS — inline, faqat shu komponent uchun. Reduced-motion CSS'da
          `@media (prefers-reduced-motion: reduce)` ustuvor bo'lib animatsiyani
          bekor qiladi (ikki himoya: React shart + CSS shart). */}
      <style>{`
        .login-logo-glow-pulse {
          animation: login-glow-pulse 3s ease-in-out infinite;
        }
        .login-logo-breathing {
          animation: login-breathing 2.4s ease-in-out infinite;
        }
        @keyframes login-glow-pulse {
          0%, 100% { filter: drop-shadow(0 0 12px rgba(233, 207, 143, 0.25)); }
          50% { filter: drop-shadow(0 0 32px rgba(233, 207, 143, 0.55)); }
        }
        @keyframes login-breathing {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.8; }
        }
        @media (prefers-reduced-motion: reduce) {
          .login-logo-glow-pulse,
          .login-logo-breathing {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
