/**
 * The ports and the client, and nothing else. `testing/` is deliberately not
 * re-exported here:
 * `store-contract` imports vitest, and a barrel that pulls it in would drag the
 * test runner into the app bundle for anyone importing `@/data`.
 */
export type {
  AssetType,
  NewTransaction,
  Portfolio,
  PortfolioWithTransactions,
  Settings,
  SettingsPatch,
  Side,
  Store,
  Transaction,
  TransactionPatch,
} from "./ports/store";
export { DEFAULT_SETTINGS } from "./ports/store";
export type { Net, NetResponse } from "./ports/net";
export { NotFoundError, RequestFailedError } from "./errors";

/**
 * The client surface. `client-contract` is deliberately absent for the same
 * reason `testing/` is: it imports vitest.
 */
export type {
  BenchmarkQuery,
  DataClient,
  NewTransactionInput,
  PortfolioDetail,
  PortfolioRef,
  PortfolioSummary,
  RestoreResult,
  SettingsDto,
  TransactionDto,
} from "./client/data-client";
export { HttpClient } from "./client/http-client";
export { DataClientProvider, useDataClient } from "./client/context";
