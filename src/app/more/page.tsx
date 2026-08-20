import Link from "next/link";
import { FlaskConical, History, Home, Settings } from "lucide-react";

const LINKS = [
  { href: "/settings", label: "Settings", Icon: Settings },
  { href: "/backtest", label: "Backtest", Icon: History },
  { href: "/analyze", label: "PineScript review", Icon: FlaskConical },
  { href: "/", label: "Home", Icon: Home },
];

export default function MorePage() {
  return (
    <main className="min-h-screen px-4 py-5 md:p-8 max-w-3xl mx-auto">
      <h1 className="text-xl md:text-2xl font-semibold mb-4 md:mb-6">More</h1>
      <ul className="space-y-3 text-sm">
        {LINKS.map(({ href, label, Icon }) => (
          <li key={href}>
            <Link className="inline-flex items-center gap-2 text-blue-600 underline" href={href}>
              <Icon size={16} aria-hidden className="text-neutral-400" />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
