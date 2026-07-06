# syntax=docker/dockerfile:1
# Onyx — prod uchun ko'p bosqichli image (Next.js 16 standalone + Prisma 6).
# Baza: node:24-slim (Debian) — Prisma engine binarlari uchun alpine'dan xavfsizroq.

# ─────────────────────────── 1) deps: to'liq node_modules ───────────────────────────
FROM node:24-slim AS deps
WORKDIR /app
# Prisma engine'lari uchun openssl kerak.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ─────────────────────────── 2) build: prisma generate + next build ─────────────────
FROM node:24-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Prisma client'ni yaratamiz (build DB'ga tegmaydi — barcha DB route'lar force-dynamic).
RUN npx prisma generate
# NEXT_TELEMETRY_DISABLED — build vaqtida telemetriya so'rovlari yo'q.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ─────────────────────────── 3) runtime: kichik standalone image ────────────────────
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# `prisma migrate deploy` runtime'da ishlashi uchun Prisma CLI kerak.
# Versiya @prisma/client (package.json) bilan mos bo'lsin — yangilaganda shu yerni ham yangilang.
RUN npm install -g prisma@6.19.3 && npm cache clean --force

# Next.js standalone chiqishi: server.js + minimal traced node_modules (Prisma client + engine ichida).
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Migratsiyalar uchun sxema + migration SQL'lar (prisma migrate deploy shularni o'qiydi).
COPY --from=build /app/prisma ./prisma

# Root bo'lmagan foydalanuvchi.
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs \
  && chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000

# Ishga tushishda: avval migratsiyalarni qo'llaymiz (idempotent), keyin serverni ishga tushiramiz.
CMD ["sh", "-c", "prisma migrate deploy && node server.js"]
