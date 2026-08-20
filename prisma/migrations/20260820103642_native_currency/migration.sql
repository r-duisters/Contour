-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "nativeCurrency" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "nativeFee" REAL;
ALTER TABLE "Transaction" ADD COLUMN "nativePrice" REAL;
