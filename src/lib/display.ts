"use client";

import { KEYS, readKey } from "./storage-keys";

/**
 * How figures are shown: which currency, and whether amounts are hidden.
 *
 * Privacy mode blanks anything that reveals size — money and quantities — while
 * leaving percentages, tickers and shares visible, so the app can be read on a
 * train without showing a stranger what it is worth.
 *
 * Both live in module state because every page formats through the same
 * helpers; components subscribe with usePrivacy() so a toggle re-renders them.
 */

const KEY = KEYS.hideAmounts;
const EVENT = KEYS.privacyEvent;

let currency: "USD" | "EUR" = "USD";
let hidden = false;

export function setDisplayCurrency(next: "USD" | "EUR"): void {
  currency = next;
}

export function displayCurrency(): "USD" | "EUR" {
  return currency;
}

export function amountsHidden(): boolean {
  return hidden;
}

/** Read the stored preference. Safe to call before the first paint. */
export function loadPrivacy(): boolean {
  if (typeof window === "undefined") return false;
  hidden = readKey(KEY) === "1";
  return hidden;
}

export function setAmountsHidden(next: boolean): void {
  hidden = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(KEY, next ? "1" : "0");
    window.dispatchEvent(new CustomEvent(EVENT));
  }
}

export function onPrivacyChange(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

const MASK = "•••••";

/** Money in the display currency, or a mask when amounts are hidden. */
export function money(n: number, maximumFractionDigits = 2): string {
  if (hidden) return MASK;
  return n.toLocaleString(currency === "EUR" ? "de-DE" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits,
  });
}

/** A holding's size, which reveals as much as its value does. */
export function quantity(n: number): string {
  if (hidden) return MASK;
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

/** Percentages stay visible: they say how it went without saying how much. */
export function percent(n: number, digits = 2): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}
