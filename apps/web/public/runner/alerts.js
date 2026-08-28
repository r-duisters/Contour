/**
 * Runs on a schedule with the app closed, in Capacitor's background runtime.
 *
 * A restricted environment: no DOM, no npm imports, no access to the app's
 * storage. It gets fetch, CapacitorKV and CapacitorNotifications, so the alert
 * rules are copied into KV by the app and evaluated here against live prices.
 *
 * Deliberately only the cheap rules — price targets and daily moves. The risk
 * metric needs about two thousand daily bars to warm up, which is not work to
 * do on a phone every quarter of an hour.
 *
 * The rules arrive already expanded: `expandRules` in
 * packages/core/src/alert-rules.ts turns each stored alert into one check per
 * symbol, resolves a portfolio-scoped rule against what is actually held, and
 * drops cash, equities and indicator rules. This runtime cannot do that work —
 * it has no imports, and "every holding" needs a valuation. It evaluates what
 * it is given and nothing more.
 *
 * This is the fallback path, not the feature. Android wakes a fifteen-minute
 * job when it chooses to, and on a battery-optimised phone often never; the
 * check that is guaranteed runs in the app, in BackgroundAlerts.tsx. Both
 * write their dedupe marks in the same shape, but not to the same store —
 * this one has CapacitorKV, the app has localStorage — so a condition can
 * notify once from each. That is the deliberate trade: a duplicate is a far
 * cheaper failure than a silence.
 */

const BINANCE = "https://api.binance.com/api/v3";
const DAY_MS = 86400000;

function readJson(key, fallback) {
  try {
    const raw = CapacitorKV.get(key);
    const value = raw && raw.value ? raw.value : raw;
    return value ? JSON.parse(value) : fallback;
  } catch (err) {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    CapacitorKV.set(key, JSON.stringify(value));
  } catch (err) {
    // storage failed; the next run simply re-evaluates
  }
}

function notify(id, title, body) {
  CapacitorNotifications.schedule([{ id, title, body }]);
}

/** One notification per rule per UTC day, so a standing condition stays quiet. */
function alreadySentToday(sent, key, day) {
  return sent[key] === day;
}

/** The app hands over the current rules whenever it is open. */
addEventListener("setRules", (resolve, reject, args) => {
  try {
    writeJson("alertRules", (args && args.rules) || []);
    resolve();
  } catch (err) {
    reject(err);
  }
});

addEventListener("alertCheck", async (resolve, reject) => {
  try {
    const rules = readJson("alertRules", []);
    if (!rules.length) return resolve();

    const symbols = [...new Set(rules.map((r) => r.symbol).filter(Boolean))];
    if (!symbols.length) return resolve();

    const priced = await fetch(
      `${BINANCE}/ticker/price?symbols=${encodeURIComponent(JSON.stringify(symbols))}`,
    ).then((r) => (r.ok ? r.json() : []));
    const prices = {};
    for (const row of priced) prices[row.symbol] = Number(row.price);

    // The price a rolling 24 hours ago, for the percentage rules.
    //
    // One request for every symbol, from Binance's own rolling window:
    // `openPrice` is the price exactly 24 hours ago, to the second. This used
    // to read 25 hourly bars per symbol and take the oldest close, which is
    // hour-aligned — so the window ran 24 to 25 hours and read 0.58 points
    // differently on ETHUSDT at 12:35 UTC on 2026-08-25. It is also one
    // request instead of one per symbol, at ~293 bytes each against 4,439,
    // which is the difference between a phone check costing kilobytes and
    // costing a hundred of them.
    //
    // `fetchDailyStats` in packages/data/src/sources/binance.ts is the same
    // call. The duplication is unavoidable — this runtime has no DOM, no
    // imports and no access to the app's code. Change one, change the other.
    const dayAgo = {};
    const pctSymbols = [...new Set(
      rules.filter((r) => r.kind === "pct_move").map((r) => r.symbol).filter(Boolean),
    )];
    if (pctSymbols.length) {
      const stats = await fetch(
        `${BINANCE}/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(pctSymbols))}&type=MINI`,
      ).then((r) => (r.ok ? r.json() : []));
      for (const row of stats) {
        const open = Number(row.openPrice);
        if (open > 0) dayAgo[row.symbol] = open;
      }
    }

    const sent = readJson("alertsSent", {});
    const day = Math.floor(Date.now() / DAY_MS);
    let id = Date.now() % 100000;

    for (const rule of rules) {
      const price = prices[rule.symbol];
      if (!price) continue;
      const name = rule.name || rule.symbol;

      if (rule.kind === "price_target") {
        const hit = rule.direction === "below" ? price <= rule.price : price >= rule.price;
        const key = `t:${rule.id}`;
        if (hit && !alreadySentToday(sent, key, day)) {
          notify(id++, `${name} ${rule.direction} ${rule.price}`, `Now ${price}`);
          sent[key] = day;
        }
      } else if (rule.kind === "pct_move") {
        const base = dayAgo[rule.symbol];
        if (!base) continue;
        const pct = ((price - base) / base) * 100;
        const key = `m:${rule.id}:${pct >= 0 ? "up" : "down"}`;
        if (Math.abs(pct) >= rule.threshold && !alreadySentToday(sent, key, day)) {
          notify(
            id++,
            `${name} ${pct >= 0 ? "up" : "down"} ${Math.abs(pct).toFixed(1)}% in 24h`,
            `Now ${price}`,
          );
          sent[key] = day;
        }
      }
    }

    // Forget yesterday's marks so the store cannot grow without bound.
    for (const key of Object.keys(sent)) if (sent[key] < day - 1) delete sent[key];
    writeJson("alertsSent", sent);
    writeJson("lastRun", Date.now());
    resolve();
  } catch (err) {
    reject(err);
  }
});
