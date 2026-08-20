-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "passwordHash" TEXT,
    "displayCurrency" TEXT NOT NULL DEFAULT 'USD',
    "equityProvider" TEXT NOT NULL DEFAULT 'yahoo',
    "equityApiKey" TEXT,
    "haUrl" TEXT,
    "haWebhookId" TEXT,
    "mqttBrokerUrl" TEXT,
    "mqttTopicPrefix" TEXT
);
INSERT INTO "new_Settings" ("displayCurrency", "haUrl", "haWebhookId", "id", "mqttBrokerUrl", "mqttTopicPrefix", "passwordHash") SELECT "displayCurrency", "haUrl", "haWebhookId", "id", "mqttBrokerUrl", "mqttTopicPrefix", "passwordHash" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
CREATE TABLE "new_Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "portfolioId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "assetType" TEXT NOT NULL DEFAULT 'crypto',
    "side" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "price" REAL NOT NULL,
    "fee" REAL NOT NULL DEFAULT 0,
    "time" BIGINT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Transaction_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" ("createdAt", "fee", "id", "note", "portfolioId", "price", "quantity", "side", "symbol", "time") SELECT "createdAt", "fee", "id", "note", "portfolioId", "price", "quantity", "side", "symbol", "time" FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
CREATE INDEX "Transaction_portfolioId_time_idx" ON "Transaction"("portfolioId", "time");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
