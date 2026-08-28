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
import type { FormatId } from "@/lib/import-formats";

type Step = "currency" | "name" | "import";
const STEPS: Step[] = ["currency", "name", "import"];

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
 * Three steps, in the order they depend on each other: the currency everything
 * will be shown in, a name for the first portfolio, then the data that goes
 * into it. Every step can be skipped — the app is usable empty, and a wizard
 * that will not let go is worse than one left half-finished.
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
      await client.createPortfolio(name.trim() || "My portfolio");
      finish();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
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
        await client.restoreBackup(text);
      } else {
        const created = await client.createPortfolio(name.trim() || "My portfolio");
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
      finish();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  const caption = busy
    ? busy
    : step === "currency" ? "What should everything be shown in?"
    : step === "name" ? "What should your portfolio be called?"
    : "Bring your data over";

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

              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={
                  step === "currency" ? saveCurrency
                  : step === "name" ? () => setStep("import")
                  : createEmpty
                }
              >
                {step === "import" ? "Start empty" : "Continue"}
              </Button>
              <button
                type="button"
                onClick={step === "import" ? finish : () => setStep(STEPS[STEPS.indexOf(step) + 1]!)}
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
