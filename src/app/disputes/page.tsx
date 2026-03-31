"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getDisputes, hasApiKey, type Dispute } from "@/lib/api";

type FilterStatus = "all" | "open" | "locked" | "resolved";

function DisputesContent() {
  const searchParams = useSearchParams();
  const statusParam = searchParams.get("status") as FilterStatus | null;
  const [filter, setFilter] = useState<FilterStatus>(statusParam ?? "all");
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchDisputes = useCallback(async () => {
    try {
      const data = await getDisputes(filter === "all" ? undefined : filter);
      setDisputes(data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load disputes");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (!hasApiKey()) {
      window.location.href = "/";
      return;
    }
    fetchDisputes();
  }, [fetchDisputes]);

  const filters: Array<{ id: FilterStatus; label: string }> = [
    { id: "all", label: "All" },
    { id: "locked", label: "Locked (Urgent)" },
    { id: "open", label: "Open" },
    { id: "resolved", label: "Resolved" },
  ];

  function statusBadge(status: string) {
    if (status === "DISPUTED_LOCKED")
      return "bg-red-400/10 text-red-400 border-red-400/20";
    if (status === "DISPUTED")
      return "bg-amber-400/10 text-amber-400 border-amber-400/20";
    return "bg-emerald-400/10 text-emerald-400 border-emerald-400/20";
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Disputes</h1>
        <button
          onClick={() => { setLoading(true); fetchDisputes(); }}
          className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] px-3 py-1.5 rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-colors"
        >
          Refresh
        </button>
      </div>

      <div className="flex gap-2">
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => { setFilter(f.id); setLoading(true); }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
              filter === f.id
                ? "border-[hsl(var(--primary))] text-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10"
                : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
            } ${f.id === "locked" ? "text-red-400 border-red-400/30" : ""}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <div className="text-red-400 text-sm">{error}</div>}

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-[hsl(var(--card))] border border-[hsl(var(--border))] animate-pulse" />
          ))}
        </div>
      ) : disputes.length === 0 ? (
        <div className="text-center py-16 text-[hsl(var(--muted-foreground))]">
          No disputes found
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[hsl(var(--border))]">
          <table className="w-full text-sm">
            <thead className="bg-[hsl(var(--card))] border-b border-[hsl(var(--border))]">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-[hsl(var(--muted-foreground))]">Trade</th>
                <th className="text-left px-4 py-3 font-medium text-[hsl(var(--muted-foreground))]">Amount</th>
                <th className="text-left px-4 py-3 font-medium text-[hsl(var(--muted-foreground))]">Buyer</th>
                <th className="text-left px-4 py-3 font-medium text-[hsl(var(--muted-foreground))]">Seller</th>
                <th className="text-left px-4 py-3 font-medium text-[hsl(var(--muted-foreground))]">Status</th>
                <th className="text-left px-4 py-3 font-medium text-[hsl(var(--muted-foreground))]">Opened</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {disputes.map((d) => (
                <tr
                  key={d.id}
                  className="border-b border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/50 transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-xs">{d.tradeId.slice(0, 8)}…</td>
                  <td className="px-4 py-3">
                    {d.trade.amount} {d.trade.offer.token}
                  </td>
                  <td className="px-4 py-3 text-xs text-[hsl(var(--muted-foreground))]">
                    {d.trade.buyer.displayName ?? d.trade.buyer.address.slice(0, 8) + "…"}
                  </td>
                  <td className="px-4 py-3 text-xs text-[hsl(var(--muted-foreground))]">
                    {d.trade.seller.displayName ?? d.trade.seller.address.slice(0, 8) + "…"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${statusBadge(d.trade.status)}`}>
                      {d.trade.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-[hsl(var(--muted-foreground))]">
                    {new Date(d.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/disputes/${d.id}`}
                      className="text-xs text-[hsl(var(--primary))] hover:underline"
                    >
                      Review →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function DisputesPage() {
  return (
    <Suspense fallback={<div className="text-[hsl(var(--muted-foreground))] animate-pulse">Loading…</div>}>
      <DisputesContent />
    </Suspense>
  );
}
