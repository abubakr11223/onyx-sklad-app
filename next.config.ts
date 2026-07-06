import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prod uchun kichik runtime image: `.next/standalone/server.js` yaratadi.
  output: "standalone",
  async rewrites() {
    // /karta — статичная «карта готовности проекта» (public/karta.html)
    return [{ source: "/karta", destination: "/karta.html" }];
  },
};

export default nextConfig;
