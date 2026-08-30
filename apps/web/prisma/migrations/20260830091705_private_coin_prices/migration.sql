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
    "mqttTopicPrefix" TEXT,
    "privateCoinPrices" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_Settings" ("displayCurrency", "equityApiKey", "equityProvider", "haUrl", "haWebhookId", "id", "mqttBrokerUrl", "mqttTopicPrefix", "passwordHash") SELECT "displayCurrency", "equityApiKey", "equityProvider", "haUrl", "haWebhookId", "id", "mqttBrokerUrl", "mqttTopicPrefix", "passwordHash" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
