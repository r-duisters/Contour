-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Alert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL DEFAULT 'indicator',
    "symbol" TEXT,
    "assetType" TEXT NOT NULL DEFAULT 'crypto',
    "portfolioId" TEXT,
    "timeframe" TEXT NOT NULL,
    "params" TEXT NOT NULL,
    "repeat" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastEvaluated" DATETIME,
    "lastBarTime" BIGINT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Alert_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Alert" ("assetType", "createdAt", "enabled", "id", "kind", "lastBarTime", "lastEvaluated", "params", "portfolioId", "symbol", "timeframe", "updatedAt") SELECT "assetType", "createdAt", "enabled", "id", "kind", "lastBarTime", "lastEvaluated", "params", "portfolioId", "symbol", "timeframe", "updatedAt" FROM "Alert";
DROP TABLE "Alert";
ALTER TABLE "new_Alert" RENAME TO "Alert";
CREATE INDEX "Alert_enabled_idx" ON "Alert"("enabled");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
