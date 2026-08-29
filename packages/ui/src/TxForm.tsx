"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import SymbolPicker from "@/components/SymbolPicker";
import { useDataClient } from "@/data/client/context";
import { priceCurrency, toNewTx, type NewTx, type TxMode } from "./tx-fields";
import Segmented from "./Segmented";
import { DISPLAY_CURRENCIES, CURRENCY_NAMES } from "@/core/currencies";
import { priceDigits, priceFieldValue } from "@/lib/price-format";
import Button from "./Button";
import { field } from "./field";

export type { NewTx } from "./tx-fields";

/** A datetime-local value for right now, in the device's own timezone. */
function localNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Record a trade.
 *
 * `lockedSymbol` fixes the asset and hides the picker — on an asset's own page
 * the ticker is already decided, and offering it again invites recording a
 * trade against the wrong holding.
 *
 * `livePrice` is what the asset costs right now, offered as a one-tap fill.
 * Most trades are recorded moments after they happen, and retyping a number
 * the page is already showing is both tedious and the easiest place in the
 * form to fat-finger a digit.
 *
 * The Cash mode is offered only when no symbol is locked. On an asset's own
 * page the ticker is already decided, and a cash mode there would be recording
 * a euro deposit against Ethereum.
 */
export default function TxForm({
  onSubmit, error, lockedSymbol, livePrice, assetType = "crypto",
}: {
  onSubmit: (tx: NewTx) => void;
  error: string | null;
  lockedSymbol?: string;
  livePrice?: number | null;
  /** Decides whether the price currency is a choice or the venue's. */
  assetType?: "crypto" | "equity";
}) {
  const client = useDataClient();
  const [symbol, setSymbol] = useState(lockedSymbol ?? "BTC");
  const [side, setSide] = useState<NewTx["side"]>("buy");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [fee, setFee] = useState("");
  const [when, setWhen] = useState("");
  const [quote, setQuote] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<string[]>([]);
  const [mode, setMode] = useState<TxMode>("trade");
  const [cashCurrency, setCashCurrency] = useState("EUR");
  const [sourceSymbol, setSourceSymbol] = useState("");

  // Which currencies this coin actually trades against. An equity has no
  // choice to offer, so it does not ask — and does not clear the list either:
  // the picker is drawn only for a coin, so a stale list is unreachable, and
  // clearing it would be a synchronous setState inside an effect.
  useEffect(() => {
    if (assetType === "equity") return;
    let cancelled = false;
    client.listQuotes(lockedSymbol ?? symbol)
      .then((q) => { if (!cancelled) setQuotes(q); })
      .catch(() => { if (!cancelled) setQuotes([]); });
    return () => { cancelled = true; };
  }, [client, assetType, lockedSymbol, symbol]);

  useEffect(() => { if (lockedSymbol) setSymbol(lockedSymbol); }, [lockedSymbol]);

  // Filled after mount: a timestamp rendered on the server would not match the
  // client's, and it must be the phone's local time, not UTC.
  useEffect(() => {
    if (when === "") setWhen(localNow());
  }, [when]);

  function submit() {
    const tx = toNewTx({
      mode, symbol, side, quantity, price, fee, when,
      currency: mode === "cash" ? cashCurrency : currency,
      sourceSymbol,
    });
    if (!tx) return;
    onSubmit(tx);
    setQuantity(""); setPrice(""); setFee(""); setSourceSymbol(""); setWhen(localNow());
  }

  /**
   * Switching mode carries the side over, and the two vocabularies only
   * overlap on the transfers. Buy has no meaning for a bank balance and
   * Income has none for a coin purchase, so an unmapped side is reset rather
   * than left showing a value its own dropdown does not offer.
   */
  function switchMode(next: TxMode) {
    setMode(next);
    if (next === "cash" && (side === "buy" || side === "sell")) setSide("transfer_in");
    if (next === "trade" && side === "income") setSide("buy");
  }

  const input = field();
  // A stored symbol is an asset now, so the quote cannot be read out of it —
  // it is chosen for a coin and fixed by the venue for a listed security.
  const currency = priceCurrency(lockedSymbol ?? symbol, assetType, quote);
  const isCash = mode === "cash";
  const pricePlaceholder = `Price (${currency})`;
  return (
    <div className="mb-4">
      {!lockedSymbol && (
        <Segmented
          className="mb-3"
          value={mode}
          onChange={switchMode}
          options={[{ key: "trade", label: "Trade" }, { key: "cash", label: "Cash" }] as const}
        />
      )}
      <div className="flex gap-2 flex-wrap items-center">
        {isCash ? (
          <select className={input} aria-label="Currency" value={cashCurrency}
                  onChange={(e) => setCashCurrency(e.target.value)}>
            {DISPLAY_CURRENCIES.map((c) => (
              <option key={c} value={c}>{c} — {CURRENCY_NAMES[c]}</option>
            ))}
          </select>
        ) : lockedSymbol ? (
          <span className={`${input} font-mono text-neutral-400`}>{lockedSymbol}</span>
        ) : (
          <SymbolPicker className={`${input} uppercase w-28`} value={symbol} onChange={setSymbol} />
        )}
        <select className={input} value={side} onChange={(e) => setSide(e.target.value as NewTx["side"])}>
          {isCash ? (
            <>
              <option value="transfer_in">Deposit</option>
              <option value="transfer_out">Withdrawal</option>
              <option value="income">Income</option>
            </>
          ) : (
            <>
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
              <option value="transfer_in">Transfer in</option>
              <option value="transfer_out">Transfer out</option>
            </>
          )}
        </select>
        <input className={`${input} w-32`} value={quantity} onChange={(e) => setQuantity(e.target.value)}
               placeholder={isCash ? "Amount" : "Quantity"} inputMode="decimal" />
        {/* Only for income, and optional: bank interest is paid by nothing. */}
        {isCash && side === "income" && (
          // `placeholder:normal-case` because `uppercase` applies to the
          // placeholder too, and "PAID BY (OPTIONAL)" shouts a hint that
          // BRAND.md wants in sentence case. Typed tickers still uppercase.
          <SymbolPicker className={`${input} uppercase placeholder:normal-case w-36`}
                        value={sourceSymbol} onChange={setSourceSymbol}
                        placeholder="Paid by (optional)" />
        )}
        {!isCash && assetType === "crypto" && quotes.length > 0 && (
          <select className={input} aria-label="Price currency"
                  value={currency} onChange={(e) => setQuote(e.target.value)}>
            {quotes.map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
        )}
        {/* No price and no fee in cash mode: one euro is worth one euro, and
            a price box beside an amount box invites typing the amount twice. */}
        {!isCash && (
          <input className={`${input} w-32`} value={price} onChange={(e) => setPrice(e.target.value)}
                 placeholder={pricePlaceholder} inputMode="decimal" />
        )}
        {/* Deliberately not `money()`: that formats in the *display* currency
            and would print a USDT price as "€2.489,64" for anyone reading in
            euros. The figure here is in the field's own currency, which the
            placeholder beside it already names. 11px is BRAND.md's floor. */}
        {!isCash && livePrice != null && livePrice > 0 && (
          <button
            type="button"
            onClick={() => setPrice(priceFieldValue(livePrice))}
            className="text-[11px] text-neutral-400 underline underline-offset-2"
          >
            Use {livePrice.toLocaleString("en-US", {
              maximumFractionDigits: priceDigits(livePrice),
            })}
          </button>
        )}
        {!isCash && (
          <input className={`${input} w-24`} value={fee} onChange={(e) => setFee(e.target.value)}
                 placeholder="Fee" inputMode="decimal" />
        )}
        <input className={input} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        <Button onClick={submit}><Plus size={14} aria-hidden />Add</Button>
      </div>
      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
    </div>
  );
}
