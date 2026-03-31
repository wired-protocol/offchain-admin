"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { WalletBridge } from "./client";
import type { BridgeConnectionState, WalletIdentity } from "./types";

// ─── Context ────────────────────────────────────────────────────────────────

interface WalletBridgeContextValue {
  bridge: WalletBridge;
  connectionState: BridgeConnectionState;
  identity: WalletIdentity | null;
  connect: () => Promise<WalletIdentity>;
  connectRelay: (pairingCode: string) => Promise<WalletIdentity>;
  disconnect: () => void;
}

const WalletBridgeContext = createContext<WalletBridgeContextValue | null>(null);

// ─── Provider ───────────────────────────────────────────────────────────────

interface WalletBridgeProviderProps {
  children: ReactNode;
  port?: number;
  appName?: string;
  relayUrl?: string;
}

export function WalletBridgeProvider({
  children,
  port,
  appName,
  relayUrl,
}: WalletBridgeProviderProps) {
  const bridgeRef = useRef<WalletBridge | null>(null);

  if (!bridgeRef.current) {
    bridgeRef.current = new WalletBridge({ port, appName });
  }
  const bridge = bridgeRef.current;

  const resolvedRelayUrl = relayUrl ?? defaultRelayUrl();

  const [connectionState, setConnectionState] =
    useState<BridgeConnectionState>("disconnected");
  const [identity, setIdentity] = useState<WalletIdentity | null>(null);

  useEffect(() => {
    bridge.onConnectionStateChange((state) => {
      setConnectionState(state);
      if (state !== "connected") {
        setIdentity(null);
      }
    });

    bridge.onDisconnect(() => {
      setIdentity(null);
    });

    bridge.onLocked(() => {
      setIdentity(null);
    });

    return () => {
      bridge.disconnect();
    };
  }, [bridge]);

  const connect = useCallback(async () => {
    const id = await bridge.connect();
    setIdentity(id);
    return id;
  }, [bridge]);

  const connectRelay = useCallback(
    async (pairingCode: string) => {
      const id = await bridge.connectRelay(resolvedRelayUrl, pairingCode);
      setIdentity(id);
      return id;
    },
    [bridge, resolvedRelayUrl],
  );

  const disconnect = useCallback(() => {
    bridge.disconnect();
    setIdentity(null);
  }, [bridge]);

  return (
    <WalletBridgeContext.Provider
      value={{ bridge, connectionState, identity, connect, connectRelay, disconnect }}
    >
      {children}
    </WalletBridgeContext.Provider>
  );
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useWalletBridge(): WalletBridgeContextValue {
  const ctx = useContext(WalletBridgeContext);
  if (!ctx) {
    throw new Error(
      "useWalletBridge must be used within a <WalletBridgeProvider>",
    );
  }
  return ctx;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function defaultRelayUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:4000/ws/bridge";
  const base = process.env.NEXT_PUBLIC_WS_URL;
  if (base) {
    return `${base}/ws/bridge`;
  }
  if (window.location.protocol === "https:") {
    const apiHost = window.location.hostname.replace("wired-p2p-admin", "wired-p2p-api");
    return `wss://${apiHost}/ws/bridge`;
  }
  return `ws://${window.location.host}/ws/bridge`;
}
