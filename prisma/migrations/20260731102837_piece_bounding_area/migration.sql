-- W6-A2 — Piece.boundingAreaMm2: STORED generated column for /poisk §6.5 ranking.
--
-- Expression = "boundingLengthMm" * "boundingWidthMm" (mm²) — AYNAN UI display
-- kaliti (src/lib/poisk-query.ts pieceBoundingAreaMm2 / rankAndCapFittingPieces).
-- Bu ustun bilan Postgres `ORDER BY "boundingAreaMm2" ASC LIMIT 501` qila oladi;
-- W6-A ning «to'liq match set xotiraga» yondashuvi endi kerak emas.
--
-- Prisma tilida GENERATED ALWAYS AS … STORED yo'q — ustun SQL'da yaratiladi,
-- schema.prisma'da `@default(dbgenerated(...))` bilan Client INSERT'da
-- yozmaydi (DB hisoblaydi). Shablon: 20260730185115 (SQL-only pg_trgm / raw DDL).
--
-- CONCURRENTLY YO'Q — ko'p-statement migratsiya Prisma tranzaksiyasida
-- (postgresql: CONCURRENTLY transaction block ichida bo'lmaydi; prisma#14456).
-- IF NOT EXISTS — qayta deploy / qo'lda oldindan yaratish xavfsiz (idempotent).

-- Generated column: L va W o'zgaganda avtomatik yangilanadi (STORED).
-- INTEGER: amaliy gabaritlar (mm) mahsuloti 2^31 ichida; seed-perf max ~3k×2k.
ALTER TABLE "Piece"
    ADD COLUMN IF NOT EXISTS "boundingAreaMm2" INTEGER
    GENERATED ALWAYS AS ("boundingLengthMm" * "boundingWidthMm") STORED;

-- /poisk: WHERE status='AVAILABLE' … ORDER BY boundingAreaMm2 ASC LIMIT 501.
-- status tenglik oldinda — (status, boundingAreaMm2) planner uchun foydali.
CREATE INDEX IF NOT EXISTS "Piece_status_boundingAreaMm2_idx"
    ON "Piece"("status", "boundingAreaMm2");
