-- ТЗ №20 I — онлайн-каталог и подборки (§10). Только добавления: у всех
-- существующих видов флаг «Показывать в каталоге» включён (DEFAULT true),
-- новые таблицы пустые.

-- §10.1 — флаг вида «Показывать в каталоге» (выключает владелец).
ALTER TABLE "StoneType" ADD COLUMN "showInCatalog" BOOLEAN NOT NULL DEFAULT true;

-- §10.3 — подборка для клиента.
CREATE TABLE "Collection" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "clientId" TEXT,
  "managerId" TEXT NOT NULL,
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Collection_code_key" ON "Collection"("code");
CREATE INDEX "Collection_managerId_createdAt_idx" ON "Collection"("managerId", "createdAt");
CREATE INDEX "Collection_clientId_idx" ON "Collection"("clientId");
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_managerId_fkey"
  FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- §10.3 — камни подборки (комментарий, «Нравится», порядок).
CREATE TABLE "CollectionItem" (
  "id" TEXT NOT NULL,
  "collectionId" TEXT NOT NULL,
  "stoneTypeId" TEXT NOT NULL,
  "stoneCode" TEXT NOT NULL,
  "comment" TEXT,
  "likedAt" TIMESTAMP(3),
  "sort" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CollectionItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CollectionItem_collectionId_stoneCode_key" ON "CollectionItem"("collectionId", "stoneCode");
CREATE INDEX "CollectionItem_stoneTypeId_idx" ON "CollectionItem"("stoneTypeId");
ALTER TABLE "CollectionItem" ADD CONSTRAINT "CollectionItem_collectionId_fkey"
  FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CollectionItem" ADD CONSTRAINT "CollectionItem_stoneTypeId_fkey"
  FOREIGN KEY ("stoneTypeId") REFERENCES "StoneType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
