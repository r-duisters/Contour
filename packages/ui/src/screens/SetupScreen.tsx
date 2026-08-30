"use client";

import { useState } from "react";
import { useDataClient } from "@/data/client/context";
import { asDisplayCurrency, type DisplayCurrency } from "@/lib/currencies";
import { KEYS } from "@/lib/storage-keys";
import Button from "../Button";
import MarkTile from "../MarkTile";
import CurrencyField from "../CurrencyField";
import TradingBackdrop from "../TradingBackdrop";
import ImportSources from "../ImportSources";
import { field } from "../field";
import { importKindOf } from "../setup-steps";
import Switch from "../Switch";
import { DEFAULT_MOVE_THRESHOLD } from "../move-threshold";
import { isBatteryExempt, requestBatteryExemption, requestNotifications } from "../device-notifications";
import type { FormatId } from "@/lib/import-formats";

type Step = "currency" | "name" | "import" | "alerts";
const STEPS: Step[] = ["currency", "name", "import", "alerts"];


/**
 * First run, on a device that starts with nothing in it.
 *
 * The web app has a database and a `/setup` that sets a password; this build
 * has neither. What it has instead is an empty SQLite file and a person who
 * has to get their own data into it, which is a different problem and gets a
 * different screen.
 *
 * **Built on the lock screen's shell, deliberately.** Same moving market
 * behind it, same centred column, same glowing 112px disc with the mark in it,
 * same title and caption beneath. These are the two screens a person meets
 * before the app proper, and they should look like the same app arriving
 * rather than two designs that happen to share a colour. Only the caption and
 * the control below it change between steps — which is also what makes the
 * import's waiting state a *state* of this screen rather than a different
 * screen swapped in for it: the mark stays exactly where it is and the ring
 * starts turning around it.
 *
 * Four steps, in the order they depend on each other: the currency everything
 * will be shown in, a name for the first portfolio, the data that goes into
 * it, and how it should reach you. Every step can be skipped — the app is
 * usable empty, and a wizard that will not let go is worse than one left
 * half-finished.
 *
 * **The notifications step comes last because it needs the others.** "Tell me
 * daily move rule is one rule meaning *every holding*, so it has to name a
 * portfolio, and there is no portfolio until data has arrived. Someone who
 * skips the import skips this too: an app with nothing in it has nothing to
 * report, and asking for notification permission then is asking for something
 * with no use yet.
 *
 * **Nothing is created until it is needed.** The portfolio is not written when
 * its name is typed: a backup brings its own portfolio, so creating one first
 * would leave an empty stray beside it and the flow would have to delete
 * something it had just made. The name is held until either a CSV needs
 * somewhere to go or the flow finishes without an import.
 */
export default function SetupScreen({ onDone }: { onDone: () => void }) {
  const client = useDataClient();
  const [step, setStep] = useState<Step>("currency");
  const [currency, setCurrency] = useState<DisplayCurrency>(asDisplayCurrency("USD"));
  const [name, setName] = useState("My portfolio");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Set once data has landed somewhere; what a portfolio-wide rule names. */
  const [portfolioId, setPortfolioId] = useState<string | null>(null);
  const [bigMoves, setBigMoves] = useState(true);
  /**
   * Null until the permission has been asked for. Once true, the remaining
   * question is whether Android will actually run the scheduled check, which
   * is a different permission and the one nobody would think to look for.
   */
  const [armed, setArmed] = useState(false);
  const [batteryExempt, setBatteryExempt] = useState<boolean | null>(null);

  function finish() {
    try {
      localStorage.setItem(KEYS.setupDone, "1");
    } catch {
      // Blocked storage costs a repeat of the wizard, not data.
    }
    onDone();
  }

  async function saveCurrency() {
    // Saved on the way past rather than at the end, so leaving the flow early
    // still keeps the one choice already made.
    try {
      await client.saveSettings({ displayCurrency: currency });
    } catch {
      // A settings row that will not write is not worth stopping setup for;
      // the currency stays changeable in Settings.
    }
    setStep("name");
  }

  async function createEmpty() {
    setError(null);
    setBusy("Creating your portfolio…");
    try {
      const created = await client.createPortfolio(name.trim() || "My portfolio");
      setPortfolioId(created.id);
      setBusy(null);
      setStep("alerts");
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  /**
   * Turn on what the switch promises, in the order the promises depend on.
   *
   * Permission first, because a rule that cannot notify is worse than no rule
   * — it looks like it is working. Then the rule itself. Then the battery
   * question, which is asked only when Android says it applies and has not
   * already been answered; where it does apply, the screen stays put and the
   * primary button becomes that request, so the two system dialogs never
   * arrive on top of each other.
   */
  async function arm() {
    if (!bigMoves || !portfolioId) { finish(); return; }
    setError(null);
    setBusy("Turning on notifications…");
    try {
      const permission = await requestNotifications();
      if (permission === "denied") {
        setError("Android refused notification permission. You can grant it later in Settings.");
        setBusy(null);
        return;
      }
      // Optional on the interface, because the web build has no local
      // notifications to schedule. Absent rather than throwing.
      await client.createAlert?.({
        kind: "pct_move",
        portfolioId,
        threshold: DEFAULT_MOVE_THRESHOLD,
      });
      const exempt = await isBatteryExempt();
      setArmed(true);
      setBatteryExempt(exempt);
      setBusy(null);
      // Nothing more to ask: either the phone has no such restriction, or it
      // has already been lifted.
      if (exempt !== false) finish();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  async function allowBackground() {
    setBusy("Waiting for Android…");
    // The answer is not checked: a refusal is a real choice — and since this
    // now opens a list the person has to find Contour in, backing out without
    // changing anything is the likelier one. The app still checks every time
    // it is opened. Either way the flow is over.
    await requestBatteryExemption().catch(() => null);
    finish();
  }

  async function importFile(file: File, format?: FormatId) {
    setError(null);
    const text = await file.text();
    // A pinned source is always a CSV reader, so it settles the question a
    // sniff would otherwise have to answer.
    const kind = format ? "csv" : importKindOf(text);
    setBusy(kind === "backup" ? "Restoring your backup…" : "Reading your transactions…");
    try {
      if (kind === "backup") {
        // The backup names its own portfolio, so the typed name goes unused —
        // which is why nothing was created for it.
        setPortfolioId((await client.restoreBackup(text)).id);
      } else {
        const created = await client.createPortfolio(name.trim() || "My portfolio");
        setPortfolioId(created.id);
        const report = await client.importCsv(created.id, text, { format });
        if (report.imported === 0) {
          // A file that produced nothing is not a success. Saying so here is
          // the difference between "your data is in" and a portfolio someone
          // discovers is empty a week later.
          setError(
            report.skipped.length > 0
              ? `Nothing imported. First problem: ${report.skipped[0]!.reason}`
              : "Nothing in that file was recognised as a transaction.",
          );
          setBusy(null);
          return;
        }
      }
      setBusy(null);
      setStep("alerts");
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  const caption = busy
    ? busy
    : step === "currency" ? "What should everything be shown in?"
    : step === "name" ? "What should your portfolio be called?"
    : step === "import" ? "Bring your data over"
    : "How should Contour reach you?";

  return (
    <div className="relative min-h-screen flex items-center justify-center px-6 py-10">
      {/* The same flat ground and moving market as the lock and login, so all
          three entrances to the app look like one app. */}
      <div className="absolute inset-0 bg-neutral-950" />
      <div className="absolute inset-0">
        <TradingBackdrop />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-6 text-center w-full max-w-sm">
        {/* The ring turns on the step a person waits at, and only there. */}
        <MarkTile size={112} glow ring={busy !== null} />

        <div>
          <p className="text-2xl font-semibold tracking-wide">Contour</p>
          {/* Keyed so each caption is a fresh node; `min-h` holds the line's
              space, or everything below would step as the words change. */}
          <p className="text-xs text-neutral-500 mt-1 min-h-4" role="status" aria-live="polite">
            {caption}
          </p>
        </div>

        {/* Nothing to do while it works — the ring above says what is
            happening, and a form that stayed interactive would invite a
            second import on top of the first. */}
        {!busy && (
          <>
            <div className="w-full text-left space-y-4">
              {step === "currency" && (
                <CurrencyField value={currency} onChange={setCurrency} />
              )}

              {step === "name" && (
                <label className="block text-sm">
                  <span className="text-neutral-400">Name</span>
                  <input
                    className={`mt-1 w-full ${field()}`}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="My portfolio"
                  />
                  <span className="text-xs text-neutral-500">
                    A backup keeps the name it was saved under, and this one is not used.
                  </span>
                </label>
              )}

              {step === "import" && (
                <div className="space-y-3">
                  <ImportSources onFile={(file, format) => void importFile(file, format)} />
                  <p className="text-xs text-neutral-500 text-center">
                    The file is read on this phone. Nothing is uploaded.
                  </p>
                </div>
              )}

              {step === "alerts" && (
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">Daily move</p>
                      <p className="text-xs text-neutral-500 mt-0.5">
                        A notification when anything you own rises or falls more than{" "}
                        {DEFAULT_MOVE_THRESHOLD}% in a day. Coins and shares both. Change
                        the figure, or turn this off, in Settings.
                      </p>
                    </div>
                    <Switch
                      checked={bigMoves}
                      onChange={setBigMoves}
                      label="Daily move"
                    />
                  </div>

                  {/*
                    Only once Android has said the restriction applies here.
                    Asking before that would be a button that does nothing on
                    a phone that never had the problem.
                  */}
                  {armed && batteryExempt === false && (
                    <p className="text-xs text-amber-500">
                      Android holds background checks back to save battery, which can
                      delay these by hours. The next screen is its own — allowing it lets
                      Contour check every half hour while it is shut.
                    </p>
                  )}

                  <p className="text-xs text-neutral-500">
                    Prices are checked on this phone, and nothing about your portfolio
                    leaves it. Shares are checked through Yahoo while the app is shut,
                    whichever provider you pick in Settings.
                  </p>
                </div>
              )}

              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={
                  step === "currency" ? saveCurrency
                  : step === "name" ? () => setStep("import")
                  : step === "import" ? createEmpty
                  // Two presses at most, and only where Android asks for two:
                  // the switch arms the rule, and if the phone then says the
                  // scheduled check is throttled, the same button becomes the
                  // trip into Android's battery list rather than stacking a
                  // second system screen on top of the first.
                  : armed && batteryExempt === false ? allowBackground
                  : arm
                }
              >
                {step === "import" ? "Start empty"
                  : step !== "alerts" ? "Continue"
                  : armed && batteryExempt === false ? "Open battery settings"
                  : bigMoves ? "Turn on notifications"
                  : "Finish"}
              </Button>
              <button
                type="button"
                onClick={
                  // Skipping the import skips the notifications step too: an
                  // app with nothing in it has nothing to report.
                  step === "import" || step === "alerts"
                    ? finish
                    : () => setStep(STEPS[STEPS.indexOf(step) + 1]!)
                }
                className="text-sm text-neutral-500 underline"
              >
                Skip
              </button>
            </div>

            <p className="text-xs text-neutral-600">
              Step {STEPS.indexOf(step) + 1} of {STEPS.length}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
