/*
  Warnings:

  - The `contractId` column on the `Bet` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- DropIndex
DROP INDEX "Bet_contractId_key";

-- AlterTable
ALTER TABLE "Bet" DROP COLUMN "contractId",
ADD COLUMN     "contractId" INTEGER NOT NULL DEFAULT 0;
