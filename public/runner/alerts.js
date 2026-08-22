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

    // Yesterday's close, for the percentage rules.
    const prevCloses = {};
    for (const rule of rules) {
      if (rule.kind !== "pct_move" || prevCloses[rule.symbol] !== undefined) continue;
      const bars = await fetch(
        `${BINANCE}/klines?symbol=${rule.symbol}&interval=1d&limit=2`,
      ).then((r) => (r.ok ? r.json() : []));
      const closed = bars.length >= 2 ? bars[bars.length - 2] : null;
      if (closed) prevCloses[rule.symbol] = Number(closed[4]);
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
        const prev = prevCloses[rule.symbol];
        if (!prev) continue;
        const pct = ((price - prev) / prev) * 100;
        const key = `m:${rule.id}:${pct >= 0 ? "up" : "down"}`;
        if (Math.abs(pct) >= rule.threshold && !alreadySentToday(sent, key, day)) {
          notify(
            id++,
            `${name} ${pct >= 0 ? "up" : "down"} ${Math.abs(pct).toFixed(1)}% today`,
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
