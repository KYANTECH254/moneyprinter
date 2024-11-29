-- CreateTable
CREATE TABLE "Bet" (
    "id" SERIAL NOT NULL,
    "contractId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT '',
    "profit" DOUBLE PRECISION NOT NULL,
    "betAmount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StakeDetails" (
    "id" SERIAL NOT NULL,
    "stake" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "appId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StakeDetails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Bet_contractId_key" ON "Bet"("contractId");
