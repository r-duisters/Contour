"use client";

import { useState } from "react";
import { useDataClient } from "@/data/client/context";
import { asDisplayCurrency, type DisplayCurrency } from "@/lib/currencies";
import { KEYS } from "@/lib/storage-keys";
import Button from "../Button";
import BusyMark from "../BusyMark";
import MarkTile from "../MarkTile";
import CurrencyField from "../CurrencyField";
import { field } from "../field";
import { importKindOf } from "../setup-steps";

type Step = "currency" | "name" | "import";

/**
 * First run, on a device that starts with nothing in it.
 *
 * The web app has a database and a `/setup` that sets a password; this build
 * has neither. What it has instead is an empty SQLite file and a person who
 * has to get their own data into it, which is a different problem and gets a
 * different screen.
 *
 * Three steps, in the order they depend on each other: the currency everything
 * will be shown in, a name for the first portfolio, then the data that goes
 * into it. Every step can be skipped — the app is usable empty, and a wizard
 * that will not let go is worse than one that is left half-finished.
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

  async function importFile(file: File) {
    setError(null);
    const text = await file.text();
    const kind = importKindOf(text);
    setBusy(kind === "backup" ? "Restoring your backup…" : "Reading your transactions…");
    try {
      if (kind === "backup") {
        // The backup names its own portfolio, so the typed name goes unused —
        // which is why nothing was created for it.
        await client.restoreBackup(text);
      } else {
        const created = await client.createPortfolio(name.trim() || "My portfolio");
        await client.importCsv(created.id, text);
      }
      finish();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  if (busy) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <BusyMark label={busy} />
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col px-5 py-8 max-w-md mx-auto w-full">
      <div className="flex items-center gap-3 mb-8">
        <MarkTile size={48} />
        <div>
          <h1 className="text-lg font-semibold">Set up Contour</h1>
          <p className="text-xs text-neutral-500">Step {STEPS.indexOf(step) + 1} of {STEPS.length}</p>
        </div>
      </div>

      {step === "currency" && (
        <div className="space-y-6">
          <p className="text-sm text-neutral-400">
            Everything is shown in one currency. You can change it later in Settings.
          </p>
          <CurrencyField value={currency} onChange={setCurrency} />
          <Actions onNext={saveCurrency} onSkip={() => setStep("name")} next="Continue" />
        </div>
      )}

      {step === "name" && (
        <div className="space-y-6">
          <p className="text-sm text-neutral-400">
            Give your portfolio a name. If you restore a backup next, it keeps the name it
            was saved under and this one is not used.
          </p>
          <label className="block text-sm">
            <span className="text-neutral-400">Name</span>
            <input
              className={`mt-1 w-full ${field()}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My portfolio"
            />
          </label>
          <Actions onNext={() => setStep("import")} onSkip={() => setStep("import")} next="Continue" />
        </div>
      )}

      {step === "import" && (
        <div className="space-y-6">
          <p className="text-sm text-neutral-400">
            Bring your data over. A backup file from the desktop app restores everything;
            a Delta CSV export goes into the portfolio you just named.
          </p>
          <label className="block">
            <span className="sr-only">Choose a file</span>
            <input
              type="file"
              accept=".json,.csv,text/csv,application/json"
              className={`w-full ${field()}`}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importFile(file);
              }}
            />
          </label>
          <p className="text-xs text-neutral-500">
            The file is read on this phone. Nothing is uploaded.
          </p>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <Actions onNext={createEmpty} onSkip={finish} next="Start empty" />
        </div>
      )}

      {error && step !== "import" && <p className="text-xs text-red-500 mt-4">{error}</p>}
    </main>
  );
}

const STEPS: Step[] = ["currency", "name", "import"];

/** The same pair of controls on every step, so the way out never moves. */
function Actions({
  onNext,
  onSkip,
  next,
}: {
  onNext: () => void;
  onSkip: () => void;
  next: string;
}) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <Button onClick={onNext}>{next}</Button>
      <button type="button" onClick={onSkip} className="text-sm text-neutral-500 underline">
        Skip
      </button>
    </div>
  );
}
