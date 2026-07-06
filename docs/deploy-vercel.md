# Onyx — Deploy: Vercel (Hobby, bepul) + Neon (Postgres, free tier)

Maqsad: `/karta` telefonda 24/7 ochiq, ombor sahifalari (`/priemka /prodazha /bron /razbit /poisk`)
umumiy parol ostida. Hech qanday to'lov yo'q (Vercel Hobby + Neon free tier).

VPS varianti kerak bo'lsa — `docs/deploy-vps.md` (zaxira, hozircha ishlatilmaydi).

---

## Qanday ishlaydi (arxitektura)

- **Vercel** — Next.js ilovasini o'zi quradi va serverless funksiyalar sifatida ishlatadi.
  Har `git push origin main` → avtomatik yangi deploy.
- **Neon** — serverless Postgres. Vercel Marketplace integratsiyasi orqali ulanadi:
  DB'ni yaratadi va ulanish satrlarini (`DATABASE_URL` pooled + `DATABASE_URL_UNPOOLED`
  direct) Vercel muhitiga **avtomatik** qo'yadi — parolni qo'lda ko'chirmaysiz.
- **Migratsiya** — deploy paytida `vercel-build` skripti `prisma migrate deploy` ni
  ishga tushiradi (idempotent), jadvallarni Neon'da yaratadi. `KartaCell` ham shu yerda paydo bo'ladi.

Kod tomonidan tayyor (bu repo'da): `prisma/schema.prisma` da `directUrl`,
`package.json` da `vercel-build` + `postinstall`.

---

## Qadamlar (birinchi deploy)

### 1. Vercel akkaunt (brauzer)
1. https://vercel.com → **Sign Up** → **Continue with GitHub** (bir xil GitHub akkaunt bilan
   kiring — repo `abubakr11223/onyx-sklad-app` shu yerda).
2. Hobby (Personal) rejasini tanlang — bepul.

### 2. Repo'ni import qilish
1. Vercel dashboard → **Add New… → Project**.
2. `onyx-sklad-app` repo'sini tanlang → **Import**.
3. Framework: **Next.js** (avtomatik aniqlanadi). Build/Output sozlamalariga tegmang —
   `vercel-build` skripti o'zi ishlaydi.
4. **Hali Deploy bosmang** — avval DB va secretlarni qo'shamiz (3–4 qadam).
   (Agar avtomatik deploy bo'lib, DB yo'qligidan xato bersa — normal, 5-qadamdan keyin qayta deploy qilamiz.)

### 3. Neon Postgres ulash (Vercel Marketplace)
1. Loyiha → **Storage** tab → **Create Database** → **Neon** (Postgres) → **Continue**.
2. Bepul (Free) planni tanlang, region: Yevropa (masalan Frankfurt) — O'zbekistonga yaqinroq.
3. **Connect** — Vercel avtomatik qo'yadi: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`,
   `PGHOST` va h.k. Bizga birinchi ikkitasi kerak (kod shularni o'qiydi).

### 4. Ilova secretlari (parol + cookie kaliti)
Loyiha → **Settings → Environment Variables** → quyidagi 2 tasini qo'shing
(Environment: **Production** va **Preview** ni belgilang):

| Name | Value |
|------|-------|
| `APP_PASSWORD` | ombor xodimlari uchun kuchli parol (masalan `Onyx!Sklad2026`) |
| `AUTH_COOKIE_SECRET` | uzun tasodifiy satr — terminalda: `openssl rand -hex 32` |

> `AUTH_COOKIE_SECRET` ni menga ko'chirmang — o'zingiz kiriting. `openssl rand -hex 32`
> chiqishini nusxalab qo'ying.

### 5. Deploy
1. Loyiha → **Deployments** → **Redeploy** (yoki `git push` — avtomatik).
2. Build logida `prisma migrate deploy` → `Applying migration ...` ko'rinadi → jadvallar yaratildi.
3. Tugagach Vercel URL beradi: `https://onyx-sklad-app-xxxx.vercel.app`.

### 6. Tekshirish (telefondan ham)
- `…vercel.app/karta` → ochiladi, faqat o'qish (bosilmaydi). ✅
- `…vercel.app/priemka` → `/login` ga yo'naltiradi. ✅
- `/login` → `APP_PASSWORD` bilan kiring → `/priemka` ochiladi. ✅
- `…vercel.app/karta?edit` → login'dan keyin kataklar bosiladi, o'zgarish DB'ga saqlanadi
  va boshqa qurilmada 15s ichida ko'rinadi. ✅

---

## Karta kataklarini belgilash (deploy'dan keyin)
O'zgarmagan qoida: `/karta?edit` → login → katakni bos.
- **1-qatlam (texnik) kataklar** (1.1–1.8, 2.x, 3.x, 4.1) — P (planner) belgilaydi.
- **0/2/3/4-qatlam (biznes) kataklar** — faqat egasi belgilaydi.

---

## Operatsiyalar

- **Yangilash / qayta deploy:** `git push origin main` → Vercel avtomatik quradi.
- **Loglar:** Vercel dashboard → Deployments → (deploy) → Runtime/Build Logs.
  Yoki CLI: `vercel logs <url>`.
- **Migratsiya qo'shish:** lokalda `npx prisma migrate dev --name <ism>` → commit → push.
  Prod'da `vercel-build` avtomatik `migrate deploy` qiladi.
- **Demo ma'lumot (ixtiyoriy):** ombor sahifalari bo'sh bo'lmasligi uchun seed kerak bo'lsa,
  lokaldan Neon'ga: `DATABASE_URL="<neon-pooled-url>" DATABASE_URL_UNPOOLED="<neon-direct-url>" npx prisma db seed`.
  Karta uchun seed SHART EMAS (default belgilar kodda).
- **Domen (ixtiyoriy, keyin):** Vercel bepul `*.vercel.app` beradi — boss shuni ochadi.
  O'z domeningiz bo'lsa: Settings → Domains → qo'shing (Vercel HTTPS'ni o'zi beradi).

## CLI varianti (ixtiyoriy)
Brauzer o'rniga terminal orqali:
```
npm i -g vercel@latest
vercel login            # brauzerda tasdiqlash
vercel link             # repo'ni loyihaga bog'lash
vercel env add APP_PASSWORD production
vercel env add AUTH_COOKIE_SECRET production
vercel --prod           # deploy
```
Neon'ni baribir dashboard **Storage** orqali qo'shish qulayroq (env'lar avtomatik).
