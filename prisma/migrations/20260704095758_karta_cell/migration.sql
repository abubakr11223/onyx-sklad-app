-- CreateTable
CREATE TABLE "KartaCell" (
    "cellId" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "KartaCell_pkey" PRIMARY KEY ("cellId")
);
