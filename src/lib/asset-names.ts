/**
 * Human names for assets.
 *
 * Coins are a bundled table rather than a lookup: the list changes slowly, a
 * name is not worth a network round trip, and it keeps working offline. An
 * unknown ticker simply stays a ticker, which is what a trader reads anyway.
 * Equity names come from the price source, which already returns them.
 */
const COIN_NAMES: Record<string, string> = {
  AAVE: "Aave", ADA: "Cardano", ALGO: "Algorand", APT: "Aptos", ARB: "Arbitrum",
  ATOM: "Cosmos", AVAX: "Avalanche", BCH: "Bitcoin Cash", BNB: "BNB", BTC: "Bitcoin",
  DOGE: "Dogecoin", DOT: "Polkadot", EGLD: "MultiversX", ENA: "Ethena", ENS: "Ethereum Name Service",
  EOS: "EOS", ETC: "Ethereum Classic", ETH: "Ethereum", FET: "Artificial Superintelligence",
  FIL: "Filecoin", GAS: "Gas", GRT: "The Graph", HBAR: "Hedera", ICP: "Internet Computer",
  IMX: "Immutable", INJ: "Injective", IOTA: "IOTA", JUP: "Jupiter", LDO: "Lido DAO",
  LINK: "Chainlink", LTC: "Litecoin", MANA: "Decentraland", MATIC: "Polygon", MKR: "Maker",
  NEAR: "NEAR Protocol", NEO: "Neo", OP: "Optimism", PEPE: "Pepe", PYTH: "Pyth Network",
  QNT: "Quant", REQ: "Request", RENDER: "Render", RUNE: "THORChain", SAND: "The Sandbox",
  SEI: "Sei", SHIB: "Shiba Inu", SOL: "Solana", STX: "Stacks", SUB: "Substratum",
  SUI: "Sui", TAO: "Bittensor", TIA: "Celestia", TON: "Toncoin", TRX: "TRON",
  UNI: "Uniswap", VET: "VeChain", WIF: "dogwifhat", XLM: "Stellar", XMR: "Monero",
  XRP: "XRP", XTZ: "Tezos", ZEC: "Zcash",
  // Stablecoins, which show up as holdings of their own
  USDT: "Tether", USDC: "USD Coin", DAI: "Dai", BUSD: "Binance USD",
};

const CURRENCY_NAMES: Record<string, string> = {
  EUR: "Euro", USD: "US Dollar", GBP: "Pound Sterling", CHF: "Swiss Franc",
  SEK: "Swedish Krona", NOK: "Norwegian Krone", DKK: "Danish Krone", PLN: "Polish Złoty",
  CAD: "Canadian Dollar", AUD: "Australian Dollar", JPY: "Japanese Yen",
};

/** The name to show for a holding, or null when the ticker is all there is. */
export function assetName(
  symbol: string,
  assetType: "crypto" | "equity" | "cash" | undefined,
  fromSource?: string | null,
): string | null {
  if (assetType === "cash") return CURRENCY_NAMES[symbol.toUpperCase()] ?? null;
  if (assetType === "equity") return fromSource?.trim() || null;
  return COIN_NAMES[baseTicker(symbol)] ?? null;
}

/** BTCUSDT -> BTC. Quote assets are stripped so the table can be keyed by coin. */
export function baseTicker(symbol: string): string {
  const s = symbol.toUpperCase();
  for (const quote of ["USDT", "FDUSD", "BUSD", "USDC", "TUSD", "BTC", "ETH", "BNB", "EUR"]) {
    if (s.endsWith(quote) && s.length > quote.length) return s.slice(0, -quote.length);
  }
  return s;
}
