import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prod uchun kichik runtime image: `.next/standalone/server.js` yaratadi.
  output: "standalone",
  // Sirlar va zaxira tarballari build artefaktiga (.next/standalone) tushmasin.
  outputFileTracingExcludes: {
    "*": ["backups/**", "_to_delete/**", ".env*", "*.tar.gz", "*.tgz"],
  },
  experimental: {
    serverActions: {
      // Priyomka formasi rasmlarni server action orqali yuboradi
      // (patPhoto ≤15MB, batchPhoto ≤4×15MB). Default limit 1MB —
      // telefon rasmi bilan submit umuman o'tmay qolardi.
      bodySizeLimit: "80mb",
    },
  },
  async rewrites() {
    // /karta — статичная «карта готовности проекта» (public/karta.html)
    return [{ source: "/karta", destination: "/karta.html" }];
  },
};

export default nextConfig;
