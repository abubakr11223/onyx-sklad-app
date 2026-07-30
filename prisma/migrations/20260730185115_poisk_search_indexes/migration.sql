-- W1-A — «Поиск камня» (/poisk) uchun indekslar.
-- Har bir indeks AYNAN bitta real so'rov bilan asoslangan (fayl:qator izohda).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- NEGA CONCURRENTLY YO'Q (ataylab)
-- ─────────────────────────────────────────────────────────────────────────────
-- PostgreSQL: «a regular CREATE INDEX command can be performed within a
-- transaction block, but CREATE INDEX CONCURRENTLY cannot»
-- (postgresql.org/docs/current/sql-createindex.html).
-- Prisma esa bittadan ko'p statement bo'lgan migratsiyani TRANZAKSIYAGA o'raydi
-- (prisma/prisma#14456 — P3018). Ya'ni bu ko'p-statementli faylga CONCURRENTLY
-- qo'yilsa, `prisma migrate deploy` XATO bilan yiqiladi.
--
-- Kelishuv: oddiy (bloklovchi) CREATE INDEX ishlatiladi. Oddiy CREATE INDEX
-- jadvalni YOZUVGA qarshi bloklaydi (INSERT/UPDATE/DELETE kutadi), O'QISH
-- bloklanmaydi. Hozircha prod Slab/Piece jadvallari amalda bo'sh (seed-demo
-- 0 Slab / 0 Piece yaratadi — src/lib/seed-demo.ts:91-141), shuning uchun
-- qulf millisekundlar tartibida va bu xavfsiz.
--
-- ⚠️ AGAR bu migratsiya KEYINROQ, jadvallar allaqachon KATTA bo'lganda
-- qo'llanilsa — bu faylni QO'LLAMANG. O'rniga:
--   1) har bir indeksni prod'da qo'lda `CREATE INDEX CONCURRENTLY` bilan yarating
--      (DATABASE_URL_UNPOOLED orqali — pooler ustidan migratsiya ishlamaydi,
--      schema.prisma:15-18);
--   2) so'ng `npx prisma migrate resolve --applied 20260730185115_poisk_search_indexes`.
-- Barcha statementlar `IF NOT EXISTS` — shuning uchun 1-yo'l bilan oldindan
-- yaratilgan bo'lsa ham, bu fayl xatosiz qayta o'tadi (idempotent).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Trigram (pg_trgm) — `ILIKE '%q%'` uchun. Prisma tilida ifodalab bo'lmaydi,
--    shuning uchun bu yerda qo'lda (repo'dagi mavjud amaliyot: partial unique
--    indekslar — 20260703102644_domain_model/migration.sql:459,463).
--
--    Asos: src/lib/poisk-search.ts:19-28 `materialWhere(q)` —
--      name/rockType/color bo'yicha `contains` + `mode:"insensitive"`, ya'ni
--      BOSHIDA joker belgili `ILIKE '%q%'`. Bunday predikatni btree indeks
--      (StoneType_rockType_idx / StoneType_color_idx, va `name` unique)
--      UMUMAN ishlata olmaydi → to'liq katalog skani.
--    Uchta alohida GIN indeks: so'rov OR bo'lgani uchun planner ularni
--    BitmapOr bilan birlashtira oladi.
--    Neon pg_trgm 1.6 ni qo'llab-quvvatlaydi, oddiy CREATE EXTENSION bilan
--    (neon.com/docs/extensions/pg-extensions).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "StoneType_name_trgm_idx"
    ON "StoneType" USING GIN ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "StoneType_rockType_trgm_idx"
    ON "StoneType" USING GIN ("rockType" gin_trgm_ops);

-- "color" nullable — GIN NULL qatorlarni indekslamaydi, bu shu yerda to'g'ri
-- (NULL hech qachon ILIKE'ga mos kelmaydi).
CREATE INDEX IF NOT EXISTS "StoneType_color_trgm_idx"
    ON "StoneType" USING GIN ("color" gin_trgm_ops);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Btree indekslar — bular schema.prisma'da HAM `@@index` sifatida bor
--    (nomlar Prisma konvensiyasi bo'yicha: "{Jadval}_{ustun…}_idx").

-- src/app/poisk/page.tsx:96-104 — `WHERE isArchived = false [AND name > :after]
-- ORDER BY name ASC LIMIT 31`. isArchived indekslanmagan edi.
CREATE INDEX IF NOT EXISTS "StoneType_isArchived_name_idx"
    ON "StoneType"("isArchived", "name");

-- src/app/poisk/page.tsx / src/lib/poisk-query.ts — groupBy
-- `stoneTypeId IN (…) AND status='AVAILABLE' AND needsCheck=false` (TZ §7.4).
CREATE INDEX IF NOT EXISTS "Slab_stoneTypeId_status_needsCheck_idx"
    ON "Slab"("stoneTypeId", "status", "needsCheck");

-- Slab bilan bir xil groupBy (Piece).
CREATE INDEX IF NOT EXISTS "Piece_stoneTypeId_status_needsCheck_idx"
    ON "Piece"("stoneTypeId", "status", "needsCheck");

-- ─────────────────────────────────────────────────────────────────────────────
-- 2b) Ortiqcha 2-ustunli prefiks indekslar (W2-C)
-- ─────────────────────────────────────────────────────────────────────────────
-- PostgreSQL btree left-prefix: (stoneTypeId, status, needsCheck) indeks
-- `WHERE stoneTypeId=? AND status=?` so'rovlarini ham xizmat qiladi.
-- Shuning uchun domain_model dagi:
--   Slab_stoneTypeId_status_idx / Piece_stoneTypeId_status_idx
-- endi dublikat. Call-site tekshiruvi (W2-C): poisk-query groupBy (3 predikat),
-- bron/kamen/prodazha/q nested slabs|pieces (status ± needsCheck) — barchasi
-- 3-ustunli indeks bilan qamraladi; mutatorlar (sales/reservations/breaking)
-- asosan PK/id bo'yicha.
--
-- TARTIB (muhim): avval CREATE yuqorida, keyin DROP pastida. Tranzaksiya ichida
-- bir lahzada ham 3-ustunli bor (CREATE dan keyin), ham rollback butun
-- migratsiyani bekor qiladi → hech qachon «ikkisi ham yo'q» holat qolmaydi.
-- Shu migratsiya hali prod'ga qo'llanilmagan — alohida keyingi migratsiyaga
-- qoldirish ortiqcha operatsion yuk (ikkita deploy oynasi).
DROP INDEX IF EXISTS "Slab_stoneTypeId_status_idx";
DROP INDEX IF EXISTS "Piece_stoneTypeId_status_idx";

-- src/app/poisk/page.tsx — `ORDER BY areaM2 ASC LIMIT 500`,
-- where'da status='AVAILABLE' (src/lib/poisk-search.ts:48).
CREATE INDEX IF NOT EXISTS "Piece_status_areaM2_idx"
    ON "Piece"("status", "areaM2");

-- src/lib/batch-remainders.ts:139-144 — `batchId IN (…) AND originSlabId IS NULL`.
CREATE INDEX IF NOT EXISTS "Piece_batchId_originSlabId_idx"
    ON "Piece"("batchId", "originSlabId");

-- src/lib/batch-remainders.ts:233-241 — `status='ACTIVE' AND
-- targetType='BATCH_VOLUME' AND batchId IN (…) AND expiresAt > now()`.
CREATE INDEX IF NOT EXISTS "Reservation_status_targetType_batchId_expiresAt_idx"
    ON "Reservation"("status", "targetType", "batchId", "expiresAt");
