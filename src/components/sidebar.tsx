"use client";

import { useState } from "react";
import Link from "next/link";
import { clearApiKey } from "@/lib/api";
import { useWalletBridge } from "@/lib/bridge/react";

export function Sidebar() {
  const {
    connectionState,
    identity,
    connect: bridgeConnect,
    connectRelay,
    disconnect,
  } = useWalletBridge();

  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const [pairingCode, setPairingCode] = useState("");
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectStatus, setConnectStatus] = useState<string | null>(null);

  const handleLocalConnect = async () => {
    setConnectError(null);
    setConnecting(true);
    setConnectStatus("Connecting to local wallet...");
    try {
      if (connectionState !== "connected") {
        await bridgeConnect();
      }
      setShowConnectDialog(false);
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setConnecting(false);
      setConnectStatus(null);
    }
  };

  const handleRelayConnect = async () => {
    setConnectError(null);
    const code = pairingCode.trim().toUpperCase();
    if (code.length < 4) {
      setConnectError("Enter the pairing code from your wallet");
      return;
    }
    if (connectionState === "connecting") disconnect();
    setConnecting(true);
    setConnectStatus("Pairing with wallet...");
    try {
      await connectRelay(code);
      setShowConnectDialog(false);
      setPairingCode("");
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setConnecting(false);
      setConnectStatus(null);
    }
  };

  function handleLogout() {
    clearApiKey();
    disconnect();
    window.location.href = "/";
  }

  const walletConnected = connectionState === "connected" && identity;

  return (
    <>
      <aside className="w-56 shrink-0 border-r border-[hsl(var(--border))] bg-[hsl(var(--card))] flex flex-col p-4 gap-1">
        <div className="mb-6 px-2">
          <h2 className="text-lg font-bold">Wired Admin</h2>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Dispute Resolution</p>
        </div>
        <NavLink href="/" label="Dashboard" />
        <NavLink href="/disputes" label="All Disputes" />
        <NavLink href="/disputes?status=locked" label="Locked (Urgent)" urgent />
        <NavLink href="/disputes?status=open" label="Open" />
        <NavLink href="/disputes?status=resolved" label="Resolved" />

        {/* Wallet Section */}
        <div className="mt-auto space-y-2 pt-4 border-t border-[hsl(var(--border))]">
          {walletConnected ? (
            <div className="px-2 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="text-xs text-emerald-400 font-medium">Wallet Connected</span>
              </div>
              <p className="text-xs font-mono text-[hsl(var(--muted-foreground))] truncate" title={identity.address}>
                {identity.address.slice(0, 10)}...{identity.address.slice(-6)}
              </p>
              <button
                onClick={disconnect}
                className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
              >
                Disconnect Wallet
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowConnectDialog(true)}
              className="w-full py-2 rounded-xl border border-[hsl(var(--primary))]/30 text-[hsl(var(--primary))] text-sm font-medium hover:bg-[hsl(var(--primary))]/5 transition-colors"
            >
              Connect Wallet
            </button>
          )}
          <button
            onClick={handleLogout}
            className="w-full text-left px-3 py-2 rounded-lg text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
          >
            Sign Out
          </button>
        </div>
      </aside>

      {/* Connect Wallet Dialog */}
      {showConnectDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="w-full max-w-md p-6 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] space-y-4 mx-4">
            <h2 className="text-lg font-bold">Connect Operator Wallet</h2>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Connect your operator wallet to sign dispute resolution transactions on-chain.
            </p>

            {connectStatus ? (
              <div className="flex flex-col items-center gap-3 py-4">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-[hsl(var(--primary))] border-t-transparent" />
                <p className="text-sm text-[hsl(var(--muted-foreground))]">{connectStatus}</p>
                <p className="text-xs text-[hsl(var(--muted-foreground))]/60">Check your wallet for approval requests</p>
                <button
                  onClick={() => {
                    disconnect();
                    setConnecting(false);
                    setConnectStatus(null);
                    setConnectError(null);
                  }}
                  className="mt-2 px-4 py-1.5 rounded-xl border border-[hsl(var(--border))] text-sm"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-[hsl(var(--muted-foreground))] mb-3">
                    Wallet running on this device?
                  </p>
                  <button
                    className="w-full py-2.5 rounded-xl bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] text-sm font-semibold disabled:opacity-40"
                    onClick={handleLocalConnect}
                    disabled={connecting}
                  >
                    Connect Local Wallet
                  </button>
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-[hsl(var(--border))]/40" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-[hsl(var(--card))] px-2 text-[hsl(var(--muted-foreground))]/60">or</span>
                  </div>
                </div>

                <div>
                  <p className="text-sm text-[hsl(var(--muted-foreground))] mb-3">
                    Wallet on another device? Enter the pairing code.
                  </p>
                  <div className="flex gap-2">
                    <input
                      placeholder="Pairing code"
                      value={pairingCode}
                      onChange={(e) => setPairingCode(e.target.value.toUpperCase())}
                      maxLength={6}
                      className="flex-1 px-4 py-2.5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))] text-sm font-mono tracking-widest text-center focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
                    />
                    <button
                      onClick={handleRelayConnect}
                      disabled={connecting}
                      className="px-4 py-2.5 rounded-xl bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] text-sm font-semibold disabled:opacity-40"
                    >
                      Pair
                    </button>
                  </div>
                </div>

                {connectError && (
                  <p className="text-sm text-red-400">{connectError}</p>
                )}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                onClick={() => {
                  if (connecting) {
                    disconnect();
                    setConnecting(false);
                    setConnectStatus(null);
                  }
                  setShowConnectDialog(false);
                  setConnectError(null);
                }}
                className="px-4 py-2 rounded-xl border border-[hsl(var(--border))] text-sm"
              >
                {connecting ? "Cancel" : "Close"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function NavLink({ href, label, urgent }: { href: string; label: string; urgent?: boolean }) {
  return (
    <Link
      href={href}
      className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
        urgent
          ? "text-red-400 hover:bg-red-400/10"
          : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
      }`}
    >
      {label}
    </Link>
  );
}
