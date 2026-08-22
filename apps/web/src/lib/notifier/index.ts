export type NotifierPayload = {
  symbol: string;
  timeframe: string;
  /** Indicator signal kind ("long" | "short" | "exit") or a descriptive tag like "target_above:BTCUSDT". */
  signal: string;
  price: number;
  time: number;
  alertId: string;
  meta?: Record<string, unknown>;
};

export interface Notifier {
  send(payload: NotifierPayload): Promise<void>;
}
