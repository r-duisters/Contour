export type NotifierPayload = {
  symbol: string;
  timeframe: string;
  /** Indicator signal kind ("long" | "short" | "exit") or a descriptive tag like "target_above:BTCUSDT". */
  signal: string;
  price: number;
  time: number;
  alertId: string;
  /**
   * What a person reads, composed by the evaluator.
   *
   * Web Push and FCM each built their own title from `symbol` and `signal`,
   * separately and identically, and the result was "BTCUSDT ·
   * target_above:BTCUSDT" — the ticker twice and an internal routing tag on
   * somebody's lock screen. Neither had the currency or the target, so neither
   * could have written anything better. The evaluator holds all of it.
   *
   * Optional so Home Assistant is unaffected: it receives the whole payload as
   * JSON and the wording is its automation's, which is the point of a webhook.
   */
  text?: { title: string; body: string };
  meta?: Record<string, unknown>;
};

export interface Notifier {
  send(payload: NotifierPayload): Promise<void>;
}
