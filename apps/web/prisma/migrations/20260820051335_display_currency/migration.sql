-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "passwordHash" TEXT,
    "displayCurrency" TEXT NOT NULL DEFAULT 'USD',
    "haUrl" TEXT,
    "haWebhookId" TEXT,
    "mqttBrokerUrl" TEXT,
    "mqttTopicPrefix" TEXT
);
INSERT INTO "new_Settings" ("haUrl", "haWebhookId", "id", "mqttBrokerUrl", "mqttTopicPrefix", "passwordHash") SELECT "haUrl", "haWebhookId", "id", "mqttBrokerUrl", "mqttTopicPrefix", "passwordHash" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
