-- Аудит 2026-08-10 — троттлинг неудачных входов (/login).
-- Составной PK (scope, key): одна строка на «email:<адрес>» и на «ip:<адрес>».
-- Индекс по lastAt — для ленивой очистки просроченных окон.

CREATE TABLE IF NOT EXISTS "LoginAttempt" (
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("scope", "key")
);

CREATE INDEX IF NOT EXISTS "LoginAttempt_lastAt_idx" ON "LoginAttempt"("lastAt");
