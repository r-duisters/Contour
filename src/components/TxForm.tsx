"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import SymbolPicker from "@/components/SymbolPicker";

export type NewTx = {
  symbol: string;
  side: "buy" | "sell" | "transfer_in" | "transfer_out";
  quantity: number;
  price: number;
  fee: number;
  time: number;
};

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
 */
export default function TxForm({
  onSubmit, error, lockedSymbol,
}: {
  onSubmit: (tx: NewTx) => void;
  error: string | null;
  lockedSymbol?: string;
}) {
  const [symbol, setSymbol] = useState(lockedSymbol ?? "BTCUSDT");
  const [side, setSide] = useState<NewTx["side"]>("buy");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [fee, setFee] = useState("");
  const [when, setWhen] = useState("");

  useEffect(() => { if (lockedSymbol) setSymbol(lockedSymbol); }, [lockedSymbol]);

  // Filled after mount: a timestamp rendered on the server would not match the
  // client's, and it must be the phone's local time, not UTC.
  useEffect(() => {
    if (when === "") setWhen(localNow());
  }, [when]);

  function submit() {
    const q = Number(quantity);
    const p = Number(price);
    const f = fee === "" ? 0 : Number(fee);
    const t = new Date(when).getTime();
    if (!symbol || !Number.isFinite(q) || q <= 0 || !Number.isFinite(p) || p < 0 || !Number.isFinite(t)) return;
    onSubmit({ symbol: symbol.toUpperCase(), side, quantity: q, price: p, fee: f, time: t });
    setQuantity(""); setPrice(""); setFee(""); setWhen(localNow());
  }

  const input = "bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm";
  return (
    <div className="mb-4">
      <div className="flex gap-2 flex-wrap items-center">
        {lockedSymbol ? (
          <span className={`${input} font-mono text-neutral-400`}>{lockedSymbol}</span>
        ) : (
          <SymbolPicker className={`${input} uppercase w-28`} value={symbol} onChange={setSymbol} />
        )}
        <select className={input} value={side} onChange={(e) => setSide(e.target.value as NewTx["side"])}>
          <option value="buy">buy</option>
          <option value="sell">sell</option>
          <option value="transfer_in">transfer in</option>
          <option value="transfer_out">transfer out</option>
        </select>
        <input className={`${input} w-32`} value={quantity} onChange={(e) => setQuantity(e.target.value)}
               placeholder="Quantity" inputMode="decimal" />
        <input className={`${input} w-32`} value={price} onChange={(e) => setPrice(e.target.value)}
               placeholder="Price (USDT)" inputMode="decimal" />
        <input className={`${input} w-24`} value={fee} onChange={(e) => setFee(e.target.value)}
               placeholder="Fee" inputMode="decimal" />
        <input className={input} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        <button onClick={submit} className="bg-blue-600 text-white rounded px-3 py-1 text-sm inline-flex items-center gap-1">
          <Plus size={14} aria-hidden />Add
        </button>
      </div>
      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
    </div>
  );
}
