# Onyx — Deploy runbook: /poisk qidiruv indekslari

Maqsad: migratsiya `20260730185115_poisk_search_indexes` ni **production Neon** ga
xavfsiz qo'llash. Bu migratsiya hech qachon real bazaga yugurmagan; W1 «prod bo'sh»
degan taxminni **demo-seed faylidan** olgan — isbot emas. Deploy oldidan o'zingiz
o'lchang.

Umumiy Vercel+Neon tartib: `docs/deploy-vercel.md`. Bu fayl **faqat** shu indekslar
to'lqini uchun.

Migratsiya nima qiladi (qisqa):

| Obyekt | Amal |
|--------|------|
| `pg_trgm` | `CREATE EXTENSION IF NOT EXISTS` |
| `StoneType_*_trgm_idx` (name, rockType, color) | GIN trigram — `ILIKE '%q%'` |
| `StoneType_isArchived_name_idx` | btree keyset/sahifa |
| `Slab_stoneTypeId_status_needsCheck_idx` | btree /poisk groupBy |
| `Piece_stoneTypeId_status_needsCheck_idx` | btree /poisk groupBy |
| `Slab_stoneTypeId_status_idx` / `Piece_…` | **DROP** (left-prefix ortiqcha, W2-C) |
| `Piece_status_areaM2_idx` | btree cap+sort |
| `Piece_batchId_originSlabId_idx` | batch-remainders |
| `Reservation_status_targetType_batchId_expiresAt_idx` | volume-bron hold |

---

## 1. Pre-flight — avval qator sonlarini o'lchang

**Taxmin qilmang.** Wave 1 «jadvallar deyarli bo'sh» deb yozgan — bu `seed-demo`
chiqishi, production emas. Neon SQL Editor yoki `psql` orqali **direct** ulanishda
(pooler emas — `DATABASE_URL_UNPOOLED`):

```sql
SELECT 'StoneType' AS tbl, COUNT(*)::bigint AS n FROM "StoneType"
UNION ALL
SELECT 'Slab', COUNT(*)::bigint FROM "Slab"
UNION ALL
SELECT 'Piece', COUNT(*)::bigint FROM "Piece"
UNION ALL
SELECT 'Reservation', COUNT(*)::bigint FROM "Reservation";
```

Natijani yozib qo'ying. Quyidagi bo'limlar shu raqamlarga tayanadi.

Mavjud indekslar (ixtiyoriy, lekin foydali):

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename IN ('StoneType', 'Slab', 'Piece', 'Reservation')
ORDER BY tablename, indexname;
```

---

## 2. Lock impact — oddiy `CREATE INDEX` nima qiladi

PostgreSQL oddiy `CREATE INDEX` (CONCURRENTLY **emas**):

- jadvalga **yozuv** (INSERT/UPDATE/DELETE) uchun AccessExclusive-ga yaqin qulf:
  ombor xodimi o'rtasida **приёмка / разбить / продажа / бронь** kutishi mumkin;
- **o'qish** (SELECT, /poisk ko'rish) odatda bloklanmaydi, lekin yozuvlar to'planishi
  keyinroq spike beradi.

Davomiylik **qator soni va jadval kengligi** bilan o'sadi (taxminiy tartib):

| `Slab` + `Piece` jami qator | Kutiladigan oyna (tartib) | Tavsiya |
|-----------------------------|---------------------------|---------|
| 0 … ~10 000 | soniya / past 10s | oddiy `npm run migrate:deploy` |
| ~10 000 … ~100 000 | o'nlab soniya | ish vaqtidan tashqari yoki CONCURRENTLY |
| > ~100 000 yoki sekin storage | daqiqalar | **majburiy** CONCURRENTLY yo'li (§3) |

**Chegara (shu loyiha):** agar `Slab` + `Piece` **≥ 50 000** yoki priёмка jonli
va yozuv to'xtashi qabul qilinmasa — §3 (CONCURRENTLY) ga o'ting. 50k — seed:perf
hajmiga yaqin; undan past va jadvallar bo'sh bo'lsa, oddiy migratsiya odatda xavfsiz.

Prisma migratsiyani **bitta tranzaksiyaga** o'raydi → `CREATE INDEX CONCURRENTLY`
shu fayl ichida **ishlamaydi** (P3018). Shuning uchun CONCURRENTLY faqat qo'lda.

---

## 3. Asosiy yo'l — kichik jadvallar (`migrate deploy`)

Deploy **kod push**dan **ajratilgan** (vercel-build migrate qilmaydi — `docs/deploy-vercel.md`).

1. Kod `main` da (yoki approve qilingan commit) va migratsiya papkasi borligini tekshiring:
   `prisma/migrations/20260730185115_poisk_search_indexes/migration.sql`
2. **Direct** URL bilan (pooler orqali migrate ishonchsiz — `schema.prisma` directUrl):

```bash
# Ulash satrlarini Vercel → Settings → Environment Variables dan oling.
# HECH QACHON chatga yopishtirmang.
export DATABASE_URL="<neon-pooled>"
export DATABASE_URL_UNPOOLED="<neon-direct>"

npx prisma migrate deploy
```

Kutilgan: `Applying migration \`20260730185115_poisk_search_indexes\`` → `All migrations have been successfully applied.`

3. Status:

```bash
npx prisma migrate status
```

---

## 4. Escape hatch — `CREATE INDEX CONCURRENTLY` (katta jadvallar)

Agar §1 bo'yicha chegara oshgan yoki lock oynasi qabul qilinmasa — **shu migratsiya
faylini deploy qilmang**. O'rniga indekslarni qo'lda yarating, keyin Prisma tarixini
«allaqachon qo'llangan» deb belgilang.

### 4.1. Qo'lda indekslar (direct / unpooled ulanish)

Har birini alohida yuguring; xato bo'lsa keyingisiga o'tmang:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "StoneType_name_trgm_idx"
    ON "StoneType" USING GIN ("name" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "StoneType_rockType_trgm_idx"
    ON "StoneType" USING GIN ("rockType" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "StoneType_color_trgm_idx"
    ON "StoneType" USING GIN ("color" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "StoneType_isArchived_name_idx"
    ON "StoneType"("isArchived", "name");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Slab_stoneTypeId_status_needsCheck_idx"
    ON "Slab"("stoneTypeId", "status", "needsCheck");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Piece_stoneTypeId_status_needsCheck_idx"
    ON "Piece"("stoneTypeId", "status", "needsCheck");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Piece_status_areaM2_idx"
    ON "Piece"("status", "areaM2");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Piece_batchId_originSlabId_idx"
    ON "Piece"("batchId", "originSlabId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Reservation_status_targetType_batchId_expiresAt_idx"
    ON "Reservation"("status", "targetType", "batchId", "expiresAt");
```

Ortiqcha prefiks indekslar (W2-C) — 3-ustunlilar **tayyor** bo'lgach:

```sql
DROP INDEX CONCURRENTLY IF EXISTS "Slab_stoneTypeId_status_idx";
DROP INDEX CONCURRENTLY IF EXISTS "Piece_stoneTypeId_status_idx";
```

> `DROP INDEX CONCURRENTLY` ba'zi Postgres versiyalarida qo'llab-quvvatlanadi.
> Agar xato bersa: ish vaqtidan tashqari oddiy `DROP INDEX IF EXISTS …`.

INVALID indeks qolmasin (CONCURRENTLY muvaffaqiyatsiz bo'lsa):

```sql
SELECT indexrelid::regclass AS idx, indisvalid
FROM pg_index
JOIN pg_class ON pg_class.oid = indexrelid
WHERE NOT indisvalid;
```

`indisvalid = false` bo'lsa — `DROP INDEX CONCURRENTLY` qilib qayta yarating.

### 4.2. Prisma tarixini yopish

Barcha indekslar (va DROP lar) joyida bo'lgach:

```bash
export DATABASE_URL="<neon-pooled>"
export DATABASE_URL_UNPOOLED="<neon-direct>"

npx prisma migrate resolve --applied 20260730185115_poisk_search_indexes
npx prisma migrate status
```

Migratsiya SQL `IF NOT EXISTS` / `DROP IF EXISTS` — agar keyin kimdir xato
bilan oddiy `migrate deploy` qilsa ham, mavjud obyektlar qayta yaratilishda
portlamaydi (idempotent).

---

## 5. `pg_trgm` — ruxsatlar

`CREATE EXTENSION IF NOT EXISTS pg_trgm` **superuser yoki extension-ruxsatli** rol
talab qiladi.

**Neon:** odatda neondb owner roli extensionlarni ochadi (`pg_trgm` Neon ro'yxatida
bor). Tekshirish:

```sql
SELECT extname, extversion FROM pg_extension WHERE extname = 'pg_trgm';
-- bo'sh → hali o'rnatilmagan

-- Mavjudlik (katalog):
SELECT * FROM pg_available_extensions WHERE name = 'pg_trgm';
```

**Muvaffaqiyatsizlik qanday ko'rinadi:**

```text
ERROR: permission denied to create extension "pg_trgm"
HINT: Must be superuser to create this extension.
```

yoki

```text
ERROR: extension "pg_trgm" is not available
```

Hal: Neon dashboard → roldagi huquq / support; yoki extensionni console dan
owner bilan bir marta ochib, keyin migratsiyani qayta yuguring (`IF NOT EXISTS`).

GIN indekslar extension **siz** yaratilmaydi — `operator class "gin_trgm_ops"
does not exist` ham shu oiladan.

---

## 6. Deploy dan keyin — EXPLAIN (o'lchangan isbot)

Hech narsa W1 da `EXPLAIN` qilinmagan. Quyidagilar **real** /poisk shakliga yaqin.
`ANALYZE` disk/IO o'qiydi — production da ehtiyotkor (sekin payt); natijada
`Index Scan` / `Bitmap Index Scan` / `BitmapOr` kutamiz, `Seq Scan` katta
jadvallarda yomon belgi.

### 6.1. Trigram (material `q`)

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, name FROM "StoneType"
WHERE "isArchived" = false
  AND (
    name ILIKE '%оникс%'
    OR "rockType" ILIKE '%оникс%'
    OR color ILIKE '%оникс%'
  )
ORDER BY name ASC
LIMIT 31;
```

Kutilgan: GIN (`*_trgm_idx`) va/yoki `StoneType_isArchived_name_idx` ishtiroki.

### 6.2. Slab / Piece groupBy (AVAILABLE + needsCheck=false)

`:typeIds` o'rniga haqiqiy id lar (masalan /poisk dagi bir nechta tur):

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT "stoneTypeId", COUNT(*)
FROM "Slab"
WHERE "stoneTypeId" = ANY (ARRAY['<id1>', '<id2>']::text[])
  AND status = 'AVAILABLE'
  AND "needsCheck" = false
GROUP BY "stoneTypeId";

EXPLAIN (ANALYZE, BUFFERS)
SELECT "stoneTypeId", COUNT(*)
FROM "Piece"
WHERE "stoneTypeId" = ANY (ARRAY['<id1>', '<id2>']::text[])
  AND status = 'AVAILABLE'
  AND "needsCheck" = false
GROUP BY "stoneTypeId";
```

Kutilgan: `Slab_stoneTypeId_status_needsCheck_idx` /
`Piece_stoneTypeId_status_needsCheck_idx`.

### 6.3. Gabarit + status (boy «предложить первыми»)

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, "areaM2", "boundingLengthMm", "boundingWidthMm"
FROM "Piece"
WHERE status = 'AVAILABLE'
  AND (
    ("boundingLengthMm" >= 1200 AND "boundingWidthMm" >= 700)
    OR ("boundingLengthMm" >= 700 AND "boundingWidthMm" >= 1200)
  )
ORDER BY "areaM2" ASC NULLS LAST
LIMIT 500;
```

Kutilgan: `Piece_status_areaM2_idx` va/yoki
`Piece_status_boundingLengthMm_boundingWidthMm_idx` (eski gabarit indeksi).

### 6.4. Indeks ro'yxati (sanity)

```sql
SELECT indexname FROM pg_indexes
WHERE indexname IN (
  'StoneType_name_trgm_idx',
  'StoneType_rockType_trgm_idx',
  'StoneType_color_trgm_idx',
  'StoneType_isArchived_name_idx',
  'Slab_stoneTypeId_status_needsCheck_idx',
  'Piece_stoneTypeId_status_needsCheck_idx',
  'Piece_status_areaM2_idx',
  'Piece_batchId_originSlabId_idx',
  'Reservation_status_targetType_batchId_expiresAt_idx'
)
ORDER BY 1;
-- 9 qator

-- W2-C: eski prefikslar YO'Q bo'lishi kerak
SELECT indexname FROM pg_indexes
WHERE indexname IN (
  'Slab_stoneTypeId_status_idx',
  'Piece_stoneTypeId_status_idx'
);
-- 0 qator
```

---

## 7. Rollback

### 7.1. To'liq bekor (barcha yangi indekslar)

`migrate deploy` **muvaffaqiyatli** bo'lganidan keyin Prisma avtomatik reverse
qilmaydi. Qo'lda:

```sql
DROP INDEX IF EXISTS "StoneType_name_trgm_idx";
DROP INDEX IF EXISTS "StoneType_rockType_trgm_idx";
DROP INDEX IF EXISTS "StoneType_color_trgm_idx";
DROP INDEX IF EXISTS "StoneType_isArchived_name_idx";
DROP INDEX IF EXISTS "Slab_stoneTypeId_status_needsCheck_idx";
DROP INDEX IF EXISTS "Piece_stoneTypeId_status_needsCheck_idx";
DROP INDEX IF EXISTS "Piece_status_areaM2_idx";
DROP INDEX IF EXISTS "Piece_batchId_originSlabId_idx";
DROP INDEX IF EXISTS "Reservation_status_targetType_batchId_expiresAt_idx";

-- W2-C drop qilgan prefikslarni qayta tiklash (rollback dan keyin kerak)
CREATE INDEX IF NOT EXISTS "Slab_stoneTypeId_status_idx"
    ON "Slab"("stoneTypeId", "status");
CREATE INDEX IF NOT EXISTS "Piece_stoneTypeId_status_idx"
    ON "Piece"("stoneTypeId", "status");
```

Prisma tarixi:

```bash
npx prisma migrate resolve --rolled-back 20260730185115_poisk_search_indexes
# yoki _prisma_migrations qatorini qo'lda o'chirish — faqat tushunib
```

`pg_trgm` extension ni odatda **o'chirmang** (boshqa obyektlar bog'liq bo'lishi mumkin).

### 7.2. Yarim holat (half-applied) nima buziladi

| Holat | Natija |
|-------|--------|
| Tranzaksiyali `migrate deploy` o'rtasida xato | Butun migratsiya rollback — eski 2-ustunli indekslar qoladi, yangilari yo'q |
| CONCURRENTLY yo'lida ba'zi indekslar bor, `resolve` yo'q | App ishlaydi; keyingi `migrate deploy` `IF NOT EXISTS` bilan o'tishi mumkin yoki chalkashlik — `migrate status` tekshiring |
| 3-ustunli yaratilgan, 2-ustunli DROP qilinmagan | Ortiqcha disk, to'g'ri reja; DROP ni keyinroq qiling |
| 2-ustunli DROP, 3-ustunli **yo'q** (qo'lda tartib buzilgan) | /poisk groupBy sekinlashadi — darhol 3-ustunlini yarating |
| Extension yo'q, GIN urinish | Migratsiya yiqiladi; btree qismi ham tranzaksiyada orqaga |

---

## 8. `seed:perf` — production ga TEGMANG

```bash
npm run seed:perf -- --yes
```

Bu skript **1000 tur / ~50 000 plita / ~10 000 bo'lak** yozadi (`src/lib/seed-perf.ts`).
**HECH QACHON** production `DATABASE_URL` bilan ishlatilmasin — real ombor
ma'lumotini iflos qiladi yoki o'chiradi (`--purge`).

Xavfsiz o'lchash yo'li:

1. Alohida Neon branch / lokal Postgres yarating.
2. Faqat o'sha URL larni export qiling:

```bash
export DATABASE_URL="postgresql://…local-or-branch…"
export DATABASE_URL_UNPOOLED="$DATABASE_URL"
npx prisma migrate deploy
npm run seed:perf -- --yes
# o'lchash: EXPLAIN, /poisk latency, …
npm run seed:perf -- --purge --yes
```

Production env ni shell da qoldirib seed ishlatish — xato.

---

## 9. Qisqa checklist

- [ ] §1 COUNT(*) yozib olindi (taxmin emas)
- [ ] ≥50k yoki jonli yozuv → §4 CONCURRENTLY; aks holda §3 `migrate deploy`
- [ ] `pg_trgm` ruxsati / mavjudligi tekshirildi
- [ ] `migrate status` clean
- [ ] §6 EXPLAIN da yangi indekslar tanlangan
- [ ] Eski `*_stoneTypeId_status_idx` yo'q (W2-C)
- [ ] `seed:perf` faqat alohida DB da

Savol bo'lsa — migratsiya sarlavhasi (`migration.sql` boshidagi CONCURRENTLY
izohi) va shu runbook; kodda taxmin qilish taqiqlangan.
