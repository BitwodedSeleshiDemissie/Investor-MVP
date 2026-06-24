-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('BUY', 'SELL', 'OPENING', 'DIVIDEND', 'INTEREST', 'COUPON', 'FEE', 'ETF_INCOME', 'LOAN_INT');

-- CreateEnum
CREATE TYPE "AssetClass" AS ENUM ('EQUITY', 'ETF', 'BOND', 'ETC');

-- CreateEnum
CREATE TYPE "PriceConvention" AS ENUM ('STRAIGHT', 'DECIMAL_FRACTION');

-- CreateTable
CREATE TABLE "Security" (
    "isin" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "assetClass" "AssetClass" NOT NULL,
    "priceConvention" "PriceConvention" NOT NULL,

    CONSTRAINT "Security_pkey" PRIMARY KEY ("isin")
);

-- CreateTable
CREATE TABLE "SecurityAlias" (
    "id" SERIAL NOT NULL,
    "rawName" TEXT NOT NULL,
    "isin" TEXT NOT NULL,

    CONSTRAINT "SecurityAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" SERIAL NOT NULL,
    "externalRef" TEXT NOT NULL,
    "tradeDate" DATE NOT NULL,
    "type" "TransactionType" NOT NULL,
    "securityIsin" TEXT,
    "quantity" DECIMAL(20,6) NOT NULL,
    "price" DECIMAL(20,8) NOT NULL,
    "fxRate" DECIMAL(12,8) NOT NULL,
    "eurAmount" DECIMAL(20,4) NOT NULL,
    "commission" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "sourceFile" TEXT,
    "notes" TEXT,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SecurityAlias_rawName_key" ON "SecurityAlias"("rawName");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_externalRef_key" ON "Transaction"("externalRef");

-- AddForeignKey
ALTER TABLE "SecurityAlias" ADD CONSTRAINT "SecurityAlias_isin_fkey" FOREIGN KEY ("isin") REFERENCES "Security"("isin") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_securityIsin_fkey" FOREIGN KEY ("securityIsin") REFERENCES "Security"("isin") ON DELETE SET NULL ON UPDATE CASCADE;
