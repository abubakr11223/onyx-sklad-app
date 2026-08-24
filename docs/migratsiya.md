# Onyx — ega serveriga ko'chirish (bitta nuqta)

Loyiha hozir **vaqtinchalik** joyda turibdi: Vercel (ilova) + Neon (baza) +
Vercel Blob (rasm). Oxirida hammasi **eganing o'z serveriga** ko'chadi.

Bu hujjatning maqsadi bitta: ko'chirish kuni **kod o'zgarmasin**. Faqat
`.env.production` to'ldiriladi va `docker compose up` beriladi.

---

## 1. Nima nimaga bog'langan

| Qism | Hozir | Ega serverida | Kodga ta'siri |
|---|---|---|---|
| Baza | Neon Postgres | Postgres 16 (compose ichida) | Yo'q — `DATABASE_URL` |
| Ilova | Vercel | Docker + Caddy (HTTPS) | Yo'q — `Dockerfile` tayyor |
| Rasm | Vercel Blob | Disk (`/data/photos` volume) | Yo'q — `PHOTO_STORAGE=local` |
| Cron | `vercel.json` | `crontab` + `curl` | Yo'q — endpoint bir xil |
| Telegram bot | bot tokeni | o'sha bot tokeni | Yo'q — webhook manzili yangilanadi |
| AI (interyer) | Anthropic API | o'sha API kaliti | Yo'q |

**Boshqa hech qanday tashqi xizmat ulanmagan** — Redis yo'q, navbat yo'q,
tashqi fayl ombori yo'q. Ataylab shunday: har bir yangi xizmat ko'chirish kunida
yana bitta muammo degani.

---

## 2. Ko'chirish kuni — tartib

1. **Zaxira ol.** Eski joyda:
   `curl -H "Authorization: Bearer $CRON_SECRET" https://<eski-domen>/api/cron/backup`
   Telegram'ga `onyx-backup-YYYY-MM-DD.json` keladi — uni saqlab qo'ying.
   Qo'shimcha: Neon Console → Branches → yangi branch (bir soniyada to'liq nusxa).
2. **Serverga Docker o'rnating** (`docs/deploy-vps.md`, 2-bo'lim).
3. **Repozitoriyani klonlang**, `.env.production.example` dan `.env.production`
   yasang va to'ldiring: `DOMAIN`, `ACME_EMAIL`, `POSTGRES_*`, `DATABASE_URL`
   (host = `db`), `AUTH_COOKIE_SECRET`, `TELEGRAM_*`, `CRON_SECRET`,
   `PHOTO_STORAGE=local`, `PHOTO_STORAGE_DIR=/data/photos`.
   `BLOB_READ_WRITE_TOKEN` **kerak emas** — qo'shmang.
4. **Ishga tushiring:** `docker compose -f docker-compose.prod.yml up -d --build`
   (migratsiyalar konteyner ichida `prisma migrate deploy` bilan avtomat).
5. **Ma'lumotni tiklang:**
   ```
   ONYX_RESTORE_ALLOW=I_UNDERSTAND_WRITE npm run restore -- --file=onyx-backup-YYYY-MM-DD.json
   ONYX_RESTORE_ALLOW=I_UNDERSTAND_WRITE npm run restore -- --file=onyx-backup-YYYY-MM-DD.json --execute --yes
   ```
   Birinchi buyruq hech narsa yozmaydi — faqat rejani ko'rsatadi.
   Mavjud id'lar o'tkazib yuboriladi, ya'ni takror yurgizish xavfsiz.
6. **Telegram webhook manzilini yangilang** (yangi domen).
7. **Cron qo'ying** (`.env.production.example` ichidagi ikki qator crontab).
8. **DNS'ni yangi serverga qarating.** Caddy sertifikatni o'zi oladi.

---

## 3. Ko'chgandan keyin tekshirish

- [ ] Kirish ishlaydi, rollar to'g'ri (`/accounts`).
- [ ] «Карта склада» blok/orientirlari joyida.
- [ ] Bitta partiya qabul qilinadi va qidiruvda chiqadi.
- [ ] Yangi rasm yuklanadi va ochiladi (ya'ni `local:` ombori ishlayapti).
- [ ] Eski rasm ham ochiladi (u hali eski URL'da — 4-bo'limga qarang).
- [ ] `curl .../api/cron/backup` → Telegram'ga zaxira keladi.
- [ ] Ertasi kuni cron o'zi ishlaganini tekshiring.

---

## 4. Ochiq savol — ESKI rasmlar

`Photo.storageKey` uchta shaklda bo'ladi:

1. `https://…` — Vercel Blob'dagi eski rasmlar. Ko'chgandan keyin ham o'sha
   manzildan ochilaveradi, **lekin ular Vercel akkauntida qoladi.** Akkaunt
   yopilsa — rasm yo'qoladi.
2. `local:…` — o'z diskimiz (yangi rasmlar).
3. boshqasi — Telegram `file_id` (bot orqali kelgan rasm). Baytlar Telegram
   serverida; bot tokeni saqlansa ishlayveradi.

Ya'ni **to'liq mustaqillik uchun** 1 va 3 ni bir kun o'z omborimizga ko'chirish
kerak: har bir yozuvni yuklab olib, `putLocalObject` bilan diskka yozib,
`storageKey`ni yangilaydigan bir martalik skript. Bu ko'chirishni to'sib
qo'ymaydi (hammasi ishlab turadi), lekin ro'yxatdan tushmasin.

---

## 5. Ma'lumot yo'qolmasligi — qatlamlar

1. **Kunlik zaxira** — `/api/cron/backup`, JSON Telegram'ga (baza tashqarisida).
2. **Tiklash** — `npm run restore` (shu hujjat, 5-qadam). Sinalgan.
3. **Neon PITR / branch** — faqat hozirgi vaqtinchalik davr uchun.
4. **Ega serverida** — `pg_dump` ni ham cronga qo'ying (tuzilma + ma'lumot):
   ```
   30 2 * * * docker exec onyx-db-1 pg_dump -U $POSTGRES_USER $POSTGRES_DB \
              | gzip > /srv/backups/onyx-$(date +\%F).sql.gz
   ```
   JSON zaxira — ma'lumot uchun, `pg_dump` — butun baza uchun. Ikkalasi ham
   bo'lsin: biri boshqasining kamchiligini yopadi.
