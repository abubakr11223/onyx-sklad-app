-- Audit 2026-09-02 — zaxira va eksport amallari jurnalga tushsin.
--
-- Nega: kunlik zaxira va butun bazani eksport qilish — ikkalasi ham
-- ma'lumotga tegadigan eng yirik amallar edi, lekin hech qayerda iz
-- qoldirmasdi. «Zaxira kelmayapti» degan savolga javob endi jurnaldan
-- chiqadi; eksport kaliti sizib chiqsa — kim, qachon yuklab olgani ko'rinadi.
--
-- Faqat qo'shadi, hech narsani o'zgartirmaydi. Idempotent: takror qo'llansa
-- xato bermaydi (loyihadagi boshqa enum migratsiyalari bilan bir uslubda).

DO $$ BEGIN
  ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BACKUP';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'EXPORT';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
