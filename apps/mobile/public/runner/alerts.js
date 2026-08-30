/**
 * Runs on a schedule with the app closed, in Capacitor's background runtime.
 *
 * A restricted environment: no DOM, no npm imports, no access to the app's
 * database or settings. It gets `fetch`, `CapacitorKV` and
 * `CapacitorNotifications` — so everything it needs is pushed into KV by
 * `device-alerts.tsx` while the app is open, and this file evaluates it.
 *
 * **The rules arrive already expanded.** `expandRules` in
 * packages/core/src/alert-rules.ts turns each stored alert into one check per
 * symbol, resolves a portfolio-scoped rule against what is actually held, and
 * carries the venue for each. This runtime cannot do that work — it has no
 * imports, and "every holding" needs a valuation — so it evaluates what it is
 * given and nothing more.
 *
 * **Deliberately only the cheap rules.** Price targets and daily moves. The
 * risk metric needs about 1,460 daily bars to warm up, which is not work to do
 * on a phone every half hour.
 *
 * **This is the fallback, not the feature.** Android runs a periodic job when
 * it chooses to, and on a battery-optimised phone often never — which is why
 * the setup flow offers to lift that restriction, and why the check that is
 * guaranteed still runs in the app, in `device-alerts.tsx`. Both write dedupe
 * marks in the same shape but not to the same store: this one has CapacitorKV,
 * the app has localStorage, so one condition can notify once from each. That
 * is the deliberate trade — a duplicate is a far cheaper failure than a
 * silence.
 *
 * **Duplication is unavoidable here and has to be maintained by hand.** The
 * Binance and Yahoo calls below mirror `packages/data/src/sources/`. Change
 * one, change the other.
 */

const BINANCE = "https://api.binance.com/api/v3";
const YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart";
const DAY_MS = 86400000;

/**
 * Yahoo answers 429 to a bare request; it wants the headers a browser XHR
 * sends, not just a User-Agent. Mirrors YAHOO_HEADERS in
 * packages/data/src/sources/equity.ts.
 */
const YAHOO_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://finance.yahoo.com/",
  Origin: "https://finance.yahoo.com",
  "sec-fetch-site": "same-site",
  "sec-fetch-mode": "cors",
};

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

/**
 * The wording, copied by hand from packages/core/src/alert-copy.ts.
 *
 * This runtime has no imports at all — the same constraint that forces the
 * Binance call above to be duplicated. Before the shared module existed these
 * two evaluators worded the same event differently ("up 5.2%" here, "up 5.2%
 * in 24h" there) and both can fire for one move, so a person received two
 * notifications that did not look like the same thing.
 *
 * Change one, change the other. `runner-wiring.test.ts` compares the strings.
 */
function amount(value, currency) {
  const digits = Math.abs(value) >= 1 ? 2 : 8;
  const shown = Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: digits });
  return `${value < 0 ? "-" : ""}${shown} ${currency}`.trim();
}

function priceTargetNotice(a) {
  return {
    title: `${a.name} ${a.direction === "below" ? "fell below" : "rose above"} ${amount(a.target, a.currency)}`,
    body: a.oneShot
      ? `Now ${amount(a.price, a.currency)} · this one-shot alert has switched itself off`
      : `Now ${amount(a.price, a.currency)} · still watching`,
  };
}

function moveNotice(a) {
  const prices = `${amount(a.from, a.currency)} → ${amount(a.price, a.currency)}`;
  return {
    title: `${a.name} ${a.direction} ${Math.abs(a.pct).toFixed(1)}% in 24 hours`,
    body: a.portfolio ? `From your daily move rule on ${a.portfolio} · ${prices}` : prices,
  };
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

/**
 * What this runner has actually been doing, for the app to show a person.
 *
 * Android decides whether a periodic job runs at all, and when it declines
 * there is no error and no event — the check simply does not happen. Until
 * this existed the app could not tell that apart from a quiet market: it
 * displayed a "last checked" time written by its *own* foreground pass, from
 * localStorage, while this runtime writes to CapacitorKV. Two stores, and the
 * line that looked like it covered both never reflected a background run.
 *
 * So the runner is asked. `dispatchEvent` resolves with whatever is passed to
 * `resolve`, which is the only channel out of here.
 */
addEventListener("getStatus", (resolve, reject) => {
  try {
    resolve({
      lastRun: readJson("lastRun", null),
      lastError: readJson("lastError", null),
      ruleCount: (readJson("alertRules", []) || []).length,
      notified: readJson("lastNotified", 0),
    });
  } catch (err) {
    reject(err);
  }
});

/**
 * Coins, in two requests however many there are.
 *
 * `openPrice` from the rolling 24-hour window is the price exactly a day ago,
 * to the second — not an hour-aligned bar close, which would make the window
 * run 24 to 25 hours and disagree with what the app shows.
 */
async function priceCrypto(symbols, needBaseline) {
  const prices = {};
  const dayAgo = {};
  if (!symbols.length) return { prices, dayAgo };

  const query = encodeURIComponent(JSON.stringify(symbols));
  const priced = await fetch(`${BINANCE}/ticker/price?symbols=${query}`)
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);
  for (const row of priced) prices[row.symbol] = Number(row.price);

  if (needBaseline.length) {
    const stats = await fetch(
      `${BINANCE}/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(needBaseline))}&type=MINI`,
    ).then((r) => (r.ok ? r.json() : [])).catch(() => []);
    for (const row of stats) {
      const open = Number(row.openPrice);
      if (open > 0) dayAgo[row.symbol] = open;
    }
  }
  return { prices, dayAgo };
}

/**
 * Shares, one request each — Yahoo's chart endpoint has no batch form.
 *
 * Keyless, and Yahoo whatever the app's configured provider is. Twelve Data
 * and Alpha Vantage both need a key, and a key would have to be copied into
 * this runtime's key store to be usable here; a background check is not worth
 * spreading a credential for. Someone on another provider still gets their
 * shares checked every time they open the app, where the configured provider
 * is used. Said plainly in the setup step rather than left to be discovered.
 *
 * The baseline is the previous close, which is what a percentage move means
 * for a share: a market that is shut has not moved, and a rolling 24 hours
 * across a weekend would report zero.
 */
async function priceEquities(symbols) {
  const prices = {};
  const dayAgo = {};
  const currencies = {};
  for (const symbol of symbols) {
    try {
      const res = await fetch(
        `${YAHOO}/${encodeURIComponent(symbol)}?range=1d&interval=1d`,
        { headers: YAHOO_HEADERS },
      );
      if (!res.ok) continue;
      const meta = ((await res.json()).chart?.result || [])[0]?.meta;
      const price = meta && meta.regularMarketPrice;
      if (typeof price !== "number") continue;
      prices[symbol] = price;
      // The venue's own currency, which is the half a share's notification
      // could never state: AMD is dollars and ASML.AS is euros.
      if (meta.currency) currencies[symbol] = meta.currency;
      const prev = meta.chartPreviousClose ?? meta.previousClose;
      if (typeof prev === "number" && prev > 0) dayAgo[symbol] = prev;
    } catch (err) {
      // One share that will not price is not a reason to skip the others.
    }
  }
  return { prices, dayAgo, currencies };
}

addEventListener("alertCheck", async (resolve, reject) => {
  try {
    const rules = readJson("alertRules", []).filter((r) => r && r.symbol);
    if (!rules.length) return resolve();

    const isEquity = (r) => r.assetType === "equity";
    const uniq = (list) => [...new Set(list)];
    const moves = rules.filter((r) => r.kind === "pct_move");

    const [coin, share] = await Promise.all([
      priceCrypto(
        uniq(rules.filter((r) => !isEquity(r)).map((r) => r.symbol)),
        uniq(moves.filter((r) => !isEquity(r)).map((r) => r.symbol)),
      ),
      priceEquities(uniq(rules.filter(isEquity).map((r) => r.symbol))),
    ]);
    const prices = { ...coin.prices, ...share.prices };
    const dayAgo = { ...coin.dayAgo, ...share.dayAgo };
    const currencies = share.currencies || {};

    const sent = readJson("alertsSent", {});
    const day = Math.floor(Date.now() / DAY_MS);
    let id = Date.now() % 100000;
    let notified = 0;

    for (const rule of rules) {
      const price = prices[rule.symbol];
      if (!price) continue;
      const name = rule.name || rule.symbol;

      const currency = isEquity(rule) ? currencies[rule.symbol] || "" : "USDT";
      if (rule.kind === "price_target") {
        const hit = rule.direction === "below" ? price <= rule.price : price >= rule.price;
        const key = `t:${rule.id}`;
        if (hit && !alreadySentToday(sent, key, day)) {
          const n = priceTargetNotice({
            name, direction: rule.direction, target: rule.price,
            price, currency, oneShot: !rule.repeat,
          });
          notify(id++, n.title, n.body);
          sent[key] = day;
          notified++;
        }
      } else if (rule.kind === "pct_move") {
        const base = dayAgo[rule.symbol];
        if (!base) continue;
        const pct = ((price - base) / base) * 100;
        const key = `m:${rule.id}:${pct >= 0 ? "up" : "down"}`;
        if (Math.abs(pct) >= rule.threshold && !alreadySentToday(sent, key, day)) {
          const n = moveNotice({
            name, direction: pct >= 0 ? "up" : "down", pct,
            from: base, price, currency, portfolio: rule.portfolio || null,
          });
          notify(id++, n.title, n.body);
          sent[key] = day;
          notified++;
        }
      }
    }

    // Forget yesterday's marks so the store cannot grow without bound.
    for (const key of Object.keys(sent)) if (sent[key] < day - 1) delete sent[key];
    writeJson("alertsSent", sent);
    writeJson("lastRun", Date.now());
    writeJson("lastNotified", notified);
    // A run that finished clears the last failure: keeping it would make one
    // bad night look like a runner that is still broken.
    writeJson("lastError", null);
    resolve();
  } catch (err) {
    // Recorded, because a throw in here is otherwise completely silent — the
    // job simply stops and Android says nothing to anybody.
    writeJson("lastError", { at: Date.now(), message: String((err && err.message) || err) });
    reject(err);
  }
});
