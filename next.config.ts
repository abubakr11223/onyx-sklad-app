import type { NextConfig } from "next";

/** Нативные файлы sharp для Linux x64 (Vercel). Локально (macOS) их нет — glob пустой. */
const SHARP_LINUX_FILES = [
  "./node_modules/@img/sharp-libvips-linux-x64/**/*",
  "./node_modules/@img/sharp-linux-x64/**/*",
];

const nextConfig: NextConfig = {
  // Prod uchun kichik runtime image: `.next/standalone/server.js` yaratadi.
  output: "standalone",
  // Sirlar va zaxira tarballari build artefaktiga (.next/standalone) tushmasin.
  outputFileTracingExcludes: {
    "*": ["backups/**", "_to_delete/**", ".env*", "*.tar.gz", "*.tgz"],
  },
  // ТЗ №20 J/K — sharp (превью текстуры, фото для ИИ) на Vercel: трассировка
  // не забирает нативную libvips (libvips-cpp.so), и модуль падает с
  // ERR_DLOPEN_FAILED. Явно кладём Linux-пакеты sharp в функции, где он нужен.
  outputFileTracingIncludes: {
    "/kamen/[id]": SHARP_LINUX_FILES,
    "/katalog": SHARP_LINUX_FILES,
    "/poisk": SHARP_LINUX_FILES,
    "/priemka": SHARP_LINUX_FILES,
    "/priemka/edit/[id]": SHARP_LINUX_FILES,
    "/api/cron/stone-traits": SHARP_LINUX_FILES,
    "/api/telegram/webhook": SHARP_LINUX_FILES,
  },
  experimental: {
    serverActions: {
      // Priyomka formasi rasmlarni server action orqali yuboradi
      // (patPhoto ≤15MB, batchPhoto ≤4×15MB). Default limit 1MB —
      // telefon rasmi bilan submit umuman o'tmay qolardi.
      bodySizeLimit: "80mb",
    },
  },
  async headers() {
    // ТЗ №20 H (§9.3) — публичные карточки по QR закрыты от поисковиков
    // (дублирует metadata.robots: заголовок видят и не-HTML-клиенты).
    return [
      {
        source: "/k/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      // ТЗ №20 I — каталог и подборки по ссылке (тоже публичные).
      {
        source: "/katalog",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/katalog/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/podborka/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      // ТЗ №20 J — 3D-режим шоу-рума (публичный).
      {
        source: "/showroom-3d",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
  async rewrites() {
    // /karta — статичная «карта готовности проекта» (public/karta.html)
    return [{ source: "/karta", destination: "/karta.html" }];
  },
};

export default nextConfig;
