import type { Signal } from "../types";

export type NotifierPayload = {
  symbol: string;
  timeframe: string;
  signal: Signal["kind"];
  price: number;
  time: number;
  alertId: string;
  meta?: Record<string, unknown>;
};

export interface Notifier {
  send(payload: NotifierPayload): Promise<void>;
}
