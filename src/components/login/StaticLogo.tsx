// TZ №8 v2 §8.1 — statik logotip (3D fallback).
//
// 2026-09-01: oldin bu yerda SVG bilan CHIZILGAN sfera imitatsiyasi turardi
// (doira + 6 ellips). Ega uni ham, 3D versiyani ham rad etdi: haqiqiy
// logotipga o'xshamas edi. Endi bu yerda kompaniyaning HAQIQIY logotipi —
// `/logo/onyx-sphere.jpg`, doira bo'yicha kesilgan.
//
// Nega baribir <svg>: slot qoidalari (`.login-logo-slot svg { width/height:
// 100% }`) va TZ testlari SVG konteynerga bog'langan. viewBox proporsiyani
// saqlaydi, <image> ichida esa aynan o'sha fayl turadi — 3D versiyaga o'tishda
// rasm brauzer keshidan olinadi, ya'ni miltillash yo'q.
//
// `variant`:
//  - "static": harakatsiz (reduced-motion, JS o'chirilgan).
//  - "glow": CSS box-shadow pulse animatsiyasi (zaif qurilma fallback).
//  - "breathing": opacity 0.4→0.8→0.4 (Suspense loading — 3D yuklanmoqda).

import type { CSSProperties } from "react";
import { LOGO_SPHERE_SRC } from "./logo-asset";

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
          {/* Rasm kvadrat, sfera esa unga aniq ichdan tegib turadi — burchaklar
              kesiladi, aks holda fonda qora kvadrat ko'rinardi. */}
          <clipPath id="login-logo-clip">
            <circle cx="0" cy="0" r="94" />
          </clipPath>
        </defs>

        {/* Yumshoq halo — sfera atrofidagi iliq nur */}
        <circle cx="0" cy="0" r="99" fill="#E9CF8F" opacity="0.05" />

        <image
          href={LOGO_SPHERE_SRC}
          x="-94"
          y="-94"
          width="188"
          height="188"
          preserveAspectRatio="xMidYMid slice"
          clipPath="url(#login-logo-clip)"
        />
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
