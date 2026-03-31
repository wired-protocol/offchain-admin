// ─── Bridge Protocol Types ───────────────────────────────────────────────────

/** Connection states for the bridge. */
export type BridgeConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "locked";

/** Wallet identity returned on successful connection. */
export interface WalletIdentity {
  address: string;
  publicKey: string;
  kyberPublicKey: string;
  ownerHash: string;
}

/** Parameters for EscrowResolve (operator dispute resolution) signing. */
export interface EscrowResolveParams {
  escrow_id: string;
  resolution: "release" | "refund";
}

/** Result from a signed transaction. */
export interface SignedTxResult {
  tx_hex: string;
  tx_hash: string;
}

// ─── Protocol Messages ──────────────────────────────────────────────────────

/** Messages sent from web app to wallet. */
export type OutgoingMessage =
  | { type: "connect"; origin: string; appName: string }
  | { type: "sign_challenge"; id: string; challenge: string }
  | {
      type: "sign_escrow_resolve";
      id: string;
      params: EscrowResolveParams;
    };

/** Messages received from wallet. */
export type IncomingMessage =
  | {
      type: "connected";
      address: string;
      publicKey: string;
      kyberPublicKey: string;
      ownerHash: string;
    }
  | { type: "rejected"; reason: string }
  | { type: "result"; id: string; data: Record<string, unknown> }
  | { type: "denied"; id: string; reason: string }
  | { type: "error"; id: string; error: string }
  | { type: "wallet_locked" };
