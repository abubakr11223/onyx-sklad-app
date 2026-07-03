import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // /karta — статичная «карта готовности проекта» (public/karta.html)
    return [{ source: "/karta", destination: "/karta.html" }];
  },
};

export default nextConfig;
