"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { getDispute, resolveDispute, hasApiKey, type Dispute } from "@/lib/api";
import { useWalletBridge } from "@/lib/bridge/react";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
      <div className="px-5 py-3 border-b border-[hsl(var(--border))]">
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-[hsl(var(--muted-foreground))] mb-0.5">{label}</p>
      <p className="text-sm">{value ?? "–"}</p>
    </div>
  );
}

export default function DisputeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { bridge, connectionState, identity } = useWalletBridge();
  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveStatus, setResolveStatus] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmAction, setConfirmAction] = useState<"RELEASE_TO_SELLER" | "REFUND_TO_BUYER" | null>(null);
  const [resolveError, setResolveError] = useState("");

  const walletConnected = connectionState === "connected" && identity;

  useEffect(() => {
    if (!hasApiKey()) { window.location.href = "/"; return; }
    getDispute(id)
      .then(setDispute)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleResolve() {
    if (!confirmAction || !dispute) return;
    if (!notes.trim()) { setResolveError("Operator notes are required"); return; }
    setResolving(true);
    setResolveError("");
    try {
      let signedTxHex: string | undefined;

      // If the trade has an on-chain escrow, we need a wallet signature
      if (dispute.trade.escrowId) {
        if (!walletConnected) {
          setResolveError("Connect your operator wallet first — an on-chain signature is required.");
          setResolving(false);
          return;
        }
        setResolveStatus("Approve the transaction in your wallet...");
        const resArg = confirmAction === "RELEASE_TO_SELLER" ? "release" as const : "refund" as const;
        const result = await bridge.signEscrowResolve({
          escrow_id: dispute.trade.escrowId,
          resolution: resArg,
        });
        signedTxHex = result.tx_hex;
      }

      setResolveStatus("Submitting resolution...");
      const updated = await resolveDispute(dispute.id, confirmAction, notes, signedTxHex);
      setDispute({ ...dispute, ...updated });
      setConfirmAction(null);
    } catch (e) {
      setResolveError(e instanceof Error ? e.message : "Failed to resolve");
    } finally {
      setResolving(false);
      setResolveStatus("");
    }
  }

  if (loading) return <div className="text-[hsl(var(--muted-foreground))] animate-pulse p-6">Loading…</div>;
  if (error) return <div className="text-red-400 p-6">{error}</div>;
  if (!dispute) return null;

  const trade = dispute.trade;
  const isResolved = Boolean(dispute.resolution);
  const isLocked = trade.status === "DISPUTED_LOCKED";

  const escrow = dispute.onChainEscrow;
  const timeoutDate = escrow ? new Date(escrow.timeout_timestamp * 1000) : null;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/disputes" className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
          ← Disputes
        </Link>
        <span className="text-[hsl(var(--muted-foreground))]/40">/</span>
        <span className="text-sm font-mono">{dispute.id.slice(0, 8)}…</span>
      </div>

      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold">Dispute Detail</h1>
        {isLocked && (
          <span className="text-sm px-3 py-1 rounded-full bg-red-400/10 text-red-400 border border-red-400/20 animate-pulse">
            URGENT — Funds Locked
          </span>
        )}
        {isResolved && (
          <span className="text-sm px-3 py-1 rounded-full bg-emerald-400/10 text-emerald-400 border border-emerald-400/20">
            Resolved
          </span>
        )}
      </div>

      {/* Trade Summary */}
      <Section title="Trade Summary">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Field label="Trade ID" value={<span className="font-mono text-xs">{trade.id}</span>} />
          <Field label="Amount" value={`${trade.amount} ${trade.offer.token}`} />
          <Field label="Fiat Amount" value={`${trade.fiatAmount} ${trade.offer.currency}`} />
          <Field label="Payment Method" value={trade.paymentMethod} />
          <Field label="Status" value={trade.status} />
          <Field label="Created" value={new Date(trade.createdAt).toLocaleString()} />
          {trade.escrowId && (
            <Field label="Escrow ID" value={<span className="font-mono text-xs">{trade.escrowId.slice(0, 16)}…</span>} />
          )}
        </div>
      </Section>

      {/* On-Chain State */}
      {escrow && (
        <Section title="On-Chain Escrow State">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <Field label="Status" value={<span className={escrow.status === "DisputedLocked" ? "text-red-400" : ""}>{escrow.status}</span>} />
            <Field label="Disputed Flag" value={escrow.disputed ? "Yes" : "No"} />
            <Field label="Timeout" value={timeoutDate ? timeoutDate.toLocaleString() : "–"} />
            {timeoutDate && <Field label="Timed Out?" value={timeoutDate < new Date() ? "Yes" : "No"} />}
          </div>
        </Section>
      )}

      {/* Parties */}
      <Section title="Parties">
        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mb-2 font-semibold uppercase tracking-wide">Buyer</p>
            <div className="space-y-2">
              <Field label="Name" value={trade.buyer.displayName ?? "(no display name)"} />
              <Field label="Address" value={<span className="font-mono text-xs">{trade.buyer.address}</span>} />
              <Field label="Reputation" value={trade.buyer.reputation} />
              <Field label="Total Trades" value={trade.buyer.totalTrades} />
            </div>
          </div>
          <div>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mb-2 font-semibold uppercase tracking-wide">Seller</p>
            <div className="space-y-2">
              <Field label="Name" value={trade.seller.displayName ?? "(no display name)"} />
              <Field label="Address" value={<span className="font-mono text-xs">{trade.seller.address}</span>} />
              <Field label="Reputation" value={trade.seller.reputation} />
              <Field label="Total Trades" value={trade.seller.totalTrades} />
            </div>
          </div>
        </div>
      </Section>

      {/* Dispute Info */}
      <Section title="Dispute Information">
        <div className="space-y-4">
          <Field
            label="Filed By"
            value={`${dispute.disputant.displayName ?? dispute.disputant.address.slice(0, 12)}… on ${new Date(dispute.createdAt).toLocaleString()}`}
          />
          <div>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1">Reason</p>
            <p className="text-sm bg-[hsl(var(--muted))] rounded-lg p-3">{dispute.reason}</p>
          </div>
          {dispute.evidence.length > 0 && (
            <div>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mb-2">Evidence ({dispute.evidence.length})</p>
              <ul className="space-y-1">
                {dispute.evidence.map((e, i) => (
                  <li key={i} className="text-sm font-mono text-xs text-[hsl(var(--primary))]">{e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Section>

      {/* Chat History */}
      {trade.messages && trade.messages.length > 0 && (
        <Section title={`Chat History (${trade.messages.length} messages)`}>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {trade.messages.map((msg) => (
              <div key={msg.id} className="text-xs p-2 rounded-lg bg-[hsl(var(--muted))]">
                <span className="font-semibold text-[hsl(var(--primary))]">
                  {msg.sender.displayName ?? msg.sender.address.slice(0, 8) + "…"}
                </span>
                {msg.type === "SYSTEM" && (
                  <span className="ml-2 text-[hsl(var(--muted-foreground))]">[system]</span>
                )}
                <span className="ml-1 text-[hsl(var(--muted-foreground))]">
                  {new Date(msg.createdAt).toLocaleTimeString()}
                </span>
                <p className="mt-0.5 text-[hsl(var(--foreground))]">{msg.content}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Resolution */}
      {isResolved ? (
        <Section title="Resolution">
          <div className="space-y-3">
            <Field label="Decision" value={<span className="text-emerald-400">{dispute.resolution?.replace(/_/g, " ")}</span>} />
            <Field label="Resolved By" value={dispute.resolvedBy} />
            <Field label="Resolved At" value={dispute.resolvedAt ? new Date(dispute.resolvedAt).toLocaleString() : "–"} />
            <div>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1">Operator Notes</p>
              <p className="text-sm bg-[hsl(var(--muted))] rounded-lg p-3">{dispute.operatorNotes}</p>
            </div>
          </div>
        </Section>
      ) : (
        <Section title="Resolution Actions">
          <div className="space-y-4">
            {/* Wallet status warning for on-chain escrows */}
            {trade.escrowId && !walletConnected && (
              <div className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg p-3">
                This dispute has an on-chain escrow. Connect your operator wallet (sidebar) to sign the resolution transaction.
              </div>
            )}
            {trade.escrowId && walletConnected && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Operator wallet connected — ready to sign on-chain resolution.
              </div>
            )}

            <div>
              <label className="text-xs text-[hsl(var(--muted-foreground))] block mb-1.5">
                Operator Notes (required)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Summarise your findings and reasoning for this resolution..."
                rows={4}
                className="w-full px-4 py-3 rounded-xl bg-[hsl(var(--muted))] border border-[hsl(var(--border))] text-sm focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))] resize-none"
              />
            </div>

            {resolveError && <p className="text-sm text-red-400">{resolveError}</p>}

            <div className="flex gap-3">
              <button
                disabled={resolving}
                onClick={() => setConfirmAction("RELEASE_TO_SELLER")}
                className="flex-1 py-2.5 rounded-xl border border-emerald-400/30 text-emerald-400 bg-emerald-400/5 hover:bg-emerald-400/10 text-sm font-semibold disabled:opacity-40 transition-colors"
              >
                Release to Seller
              </button>
              <button
                disabled={resolving}
                onClick={() => setConfirmAction("REFUND_TO_BUYER")}
                className="flex-1 py-2.5 rounded-xl border border-amber-400/30 text-amber-400 bg-amber-400/5 hover:bg-amber-400/10 text-sm font-semibold disabled:opacity-40 transition-colors"
              >
                Refund to Buyer
              </button>
            </div>
          </div>
        </Section>
      )}

      {/* Confirmation Modal */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="w-full max-w-md p-6 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] space-y-4 mx-4">
            <h2 className="text-lg font-bold">Confirm Resolution</h2>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              You are about to{" "}
              <span className="text-[hsl(var(--foreground))] font-semibold">
                {confirmAction === "RELEASE_TO_SELLER" ? "release" : "refund"}
              </span>{" "}
              <span className="text-[hsl(var(--primary))] font-semibold">
                {trade.amount} {trade.offer.token}
              </span>{" "}
              to the {confirmAction === "RELEASE_TO_SELLER" ? "seller" : "buyer"}.
            </p>
            <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg p-3">
              This will submit an on-chain transaction. The action is irreversible once confirmed on the blockchain.
            </p>
            {resolveError && <p className="text-sm text-red-400">{resolveError}</p>}
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setConfirmAction(null)}
                disabled={resolving}
                className="flex-1 py-2.5 rounded-xl border border-[hsl(var(--border))] text-sm disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handleResolve}
                disabled={resolving}
                className="flex-1 py-2.5 rounded-xl bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] text-sm font-semibold disabled:opacity-40"
              >
                {resolving ? (resolveStatus || "Submitting...") : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
