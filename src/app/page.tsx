"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  setApiKey, clearApiKey, hasApiKey,
  getStats, getDisputes, type AdminStats, type Dispute,
} from "@/lib/api";
import { Sidebar } from "@/components/sidebar";

// =============================================================================
// Login Screen
// =============================================================================
function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setApiKey(key);
    try {
      await getStats();
      onLogin();
    } catch {
      clearApiKey();
      setError("Invalid API key");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--background))]">
      <div className="w-full max-w-sm p-8 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        <h1 className="text-2xl font-bold mb-2">Wired Admin</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6">
          Enter your admin API key to continue
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            placeholder="Admin API key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))] text-sm focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={!key}
            className="w-full py-2.5 rounded-xl bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] text-sm font-semibold disabled:opacity-40"
          >
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
}

// =============================================================================
// Admin Layout
// =============================================================================
function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex">
      <Sidebar />
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}

// =============================================================================
// Dashboard
// =============================================================================
function Dashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [locked, setLocked] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([getStats(), getDisputes("locked")]);
      setStats(s);
      setLocked(l);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 15_000);
    return () => clearInterval(id);
  }, [fetchData]);

  if (loading) return <div className="text-[hsl(var(--muted-foreground))] animate-pulse">Loading…</div>;
  if (error) return <div className="text-red-400">{error}</div>;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Open Disputes" value={stats?.openDisputes ?? 0} />
        <StatCard label="Locked (Urgent)" value={stats?.lockedDisputes ?? 0} color="red" />
        <StatCard label="Resolved" value={stats?.resolvedDisputes ?? 0} color="green" />
        <StatCard
          label="Avg Resolution"
          value={stats?.avgResolutionMinutes != null ? `${stats.avgResolutionMinutes}m` : "–"}
        />
      </div>

      {/* Locked disputes — urgent */}
      {locked.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3 text-red-400">
            Urgent: Funds Locked On-Chain ({locked.length})
          </h2>
          <div className="space-y-3">
            {locked.map((d) => (
              <DisputeRow key={d.id} dispute={d} />
            ))}
          </div>
        </section>
      )}

      {locked.length === 0 && (
        <div className="text-[hsl(var(--muted-foreground))] text-sm">
          No locked disputes — all clear.
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color?: "red" | "green";
}) {
  const valueColor =
    color === "red"
      ? "text-red-400"
      : color === "green"
        ? "text-emerald-400"
        : "text-[hsl(var(--foreground))]";

  return (
    <div className="p-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
      <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1">{label}</p>
      <p className={`text-2xl font-bold ${valueColor}`}>{value}</p>
    </div>
  );
}

function DisputeRow({ dispute }: { dispute: Dispute }) {
  const statusColor =
    dispute.trade.status === "DISPUTED_LOCKED"
      ? "bg-red-400/10 text-red-400 border-red-400/20"
      : "bg-amber-400/10 text-amber-400 border-amber-400/20";

  return (
    <Link
      href={`/disputes/${dispute.id}`}
      className="flex items-center justify-between p-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:border-[hsl(var(--primary))]/30 transition-colors"
    >
      <div className="space-y-0.5">
        <p className="text-sm font-medium font-mono">
          Trade: {dispute.tradeId.slice(0, 8)}…
        </p>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          {dispute.trade.amount} {dispute.trade.offer.token} · {dispute.trade.fiatAmount}{" "}
          {dispute.trade.offer.currency}
        </p>
        <p className="text-xs text-[hsl(var(--muted-foreground))] italic truncate max-w-xs">
          {dispute.reason.slice(0, 80)}
        </p>
      </div>
      <span className={`text-xs px-2 py-0.5 rounded-full border ${statusColor}`}>
        {dispute.trade.status}
      </span>
    </Link>
  );
}

// =============================================================================
// Root Page — login gate
// =============================================================================
export default function RootPage() {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (hasApiKey()) {
      getStats()
        .then(() => setAuthed(true))
        .catch(() => clearApiKey())
        .finally(() => setChecking(false));
    } else {
      setChecking(false);
    }
  }, []);

  if (checking) return null;
  if (!authed) return <LoginScreen onLogin={() => setAuthed(true)} />;

  return (
    <AdminLayout>
      <Dashboard />
    </AdminLayout>
  );
}
