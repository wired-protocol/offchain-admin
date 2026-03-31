import type {
  BridgeConnectionState,
  EscrowResolveParams,
  IncomingMessage,
  OutgoingMessage,
  SignedTxResult,
  WalletIdentity,
} from "./types";

const DEFAULT_PORT = 9746;
const SIGNATURE_TIMEOUT = 35_000;
const RELAY_CONNECT_TIMEOUT = 30_000;
const RECONNECT_BASE_DELAY = 1_000;
const RECONNECT_MAX_DELAY = 30_000;
const RECONNECT_MAX_ATTEMPTS = 10;

type PendingRequest = {
  resolve: (data: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export interface WalletBridgeOptions {
  /** Local bridge port (default: 9746). Only used in local mode. */
  port?: number;
  /** App name shown in wallet approval dialogs. */
  appName?: string;
}

/**
 * WebSocket client for the Wired Wallet bridge (admin variant).
 *
 * Supports two connection modes:
 * - **Local**: connects directly to `ws://localhost:<port>` (wallet on same machine)
 * - **Relay**: connects via a backend relay using a pairing code (wallet on remote machine)
 */
export class WalletBridge {
  private ws: WebSocket | null = null;
  private port: number;
  private appName: string;
  private state: BridgeConnectionState = "disconnected";
  private identity: WalletIdentity | null = null;
  private pending = new Map<string, PendingRequest>();
  private requestCounter = 0;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private autoReconnect = true;
  private manualDisconnect = false;

  // Event callbacks
  private onStateChange: ((state: BridgeConnectionState) => void) | null = null;
  private onDisconnectCb: (() => void) | null = null;
  private onLockedCb: (() => void) | null = null;

  constructor(options?: WalletBridgeOptions) {
    this.port = options?.port ?? DEFAULT_PORT;
    this.appName = options?.appName ?? "Wired Admin";
  }

  // ─── Connection ──────────────────────────────────────────────────────

  get connectionState(): BridgeConnectionState {
    return this.state;
  }

  isConnected(): boolean {
    return this.state === "connected";
  }

  getIdentity(): WalletIdentity | null {
    return this.identity;
  }

  /** Connect to the wallet bridge directly (local mode). */
  async connect(): Promise<WalletIdentity> {
    if (this.state === "connected" && this.identity) {
      return this.identity;
    }

    this.manualDisconnect = false;
    this.setState("connecting");

    const url = `ws://localhost:${this.port}`;
    return this.connectToUrl(url, SIGNATURE_TIMEOUT);
  }

  /** Connect to a remote wallet via the backend relay. */
  async connectRelay(relayUrl: string, pairingCode: string): Promise<WalletIdentity> {
    if (this.state === "connected" && this.identity) {
      return this.identity;
    }

    this.manualDisconnect = false;
    this.setState("connecting");

    const url = `${relayUrl}?role=app&code=${encodeURIComponent(pairingCode)}`;
    return this.connectViaRelay(url);
  }

  /** Disconnect from the wallet bridge. */
  disconnect(): void {
    this.manualDisconnect = true;
    this.autoReconnect = false;
    this.cancelReconnect();
    this.rejectAllPending("Bridge disconnected");
    this.ws?.close();
    this.ws = null;
    this.identity = null;
    this.setState("disconnected");
  }

  onConnectionStateChange(cb: (state: BridgeConnectionState) => void): void {
    this.onStateChange = cb;
  }

  onDisconnect(cb: () => void): void {
    this.onDisconnectCb = cb;
  }

  onLocked(cb: () => void): void {
    this.onLockedCb = cb;
  }

  // ─── Signing ─────────────────────────────────────────────────────────

  async signChallenge(challenge: string): Promise<string> {
    const data = await this.request(
      { type: "sign_challenge", id: "", challenge },
      SIGNATURE_TIMEOUT,
    );
    return data.signature as string;
  }

  async signEscrowResolve(params: EscrowResolveParams): Promise<SignedTxResult> {
    const data = await this.request(
      { type: "sign_escrow_resolve", id: "", params },
      SIGNATURE_TIMEOUT,
    );
    return data as unknown as SignedTxResult;
  }

  // ─── Internal: Local Connection ────────────────────────────────────

  private connectToUrl(url: string, timeoutMs: number): Promise<WalletIdentity> {
    return new Promise<WalletIdentity>((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);
      } catch {
        this.setState("disconnected");
        reject(new Error(`Failed to create WebSocket connection to ${url}`));
        return;
      }

      const timeout = setTimeout(() => {
        this.ws?.close();
        this.setState("disconnected");
        reject(new Error("Connection timed out"));
      }, timeoutMs);

      this.ws.onopen = () => {
        this.send({
          type: "connect",
          origin: typeof window !== "undefined" ? window.location.origin : "unknown",
          appName: this.appName,
        });
      };

      this.ws.onmessage = (event) => {
        const msg = this.parseMessage(event.data);
        if (!msg) return;
        this.handleConnectResponse(msg, timeout, resolve, reject);
      };

      this.ws.onclose = () => {
        clearTimeout(timeout);
        if (this.state === "connecting") {
          this.setState("disconnected");
          reject(
            new Error(
              "Could not connect to Wired Wallet. Make sure the wallet app is running.",
            ),
          );
        } else {
          this.handleClose();
        }
      };

      this.ws.onerror = () => {};
    });
  }

  // ─── Internal: Relay Connection ────────────────────────────────────

  private connectViaRelay(url: string): Promise<WalletIdentity> {
    return new Promise<WalletIdentity>((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);
      } catch {
        this.setState("disconnected");
        reject(new Error("Failed to connect to relay"));
        return;
      }

      const timeout = setTimeout(() => {
        this.ws?.close();
        this.setState("disconnected");
        reject(new Error("Relay connection timed out"));
      }, RELAY_CONNECT_TIMEOUT);

      let paired = false;

      this.ws.onmessage = (event) => {
        const raw = this.parseJson(event.data);
        if (!raw) return;

        if ("relay" in raw) {
          if (raw.relay === "paired") {
            paired = true;
            this.send({
              type: "connect",
              origin: typeof window !== "undefined" ? window.location.origin : "unknown",
              appName: this.appName,
            });
            return;
          }
          return;
        }

        if (paired) {
          const msg = raw as IncomingMessage;
          this.handleConnectResponse(msg, timeout, resolve, reject);
        }
      };

      this.ws.onclose = (event) => {
        clearTimeout(timeout);
        if (this.state === "connecting") {
          this.setState("disconnected");
          const reason = event.reason || "Relay connection closed";
          reject(new Error(reason));
        } else {
          this.handleClose();
        }
      };

      this.ws.onerror = () => {};
    });
  }

  // ─── Internal: Shared ──────────────────────────────────────────────

  private handleConnectResponse(
    msg: IncomingMessage,
    timeout: ReturnType<typeof setTimeout>,
    resolve: (id: WalletIdentity) => void,
    reject: (err: Error) => void,
  ): void {
    if (msg.type === "connected") {
      clearTimeout(timeout);
      this.identity = {
        address: msg.address,
        publicKey: msg.publicKey,
        kyberPublicKey: msg.kyberPublicKey,
        ownerHash: msg.ownerHash,
      };
      this.setState("connected");
      this.reconnectAttempts = 0;
      this.ws!.onmessage = (e) => this.handleMessage(e);
      resolve(this.identity);
      return;
    }

    if (msg.type === "rejected") {
      clearTimeout(timeout);
      this.ws?.close();
      this.setState("disconnected");
      reject(new Error(`Connection rejected: ${msg.reason}`));
      return;
    }

    if (msg.type === "wallet_locked") {
      clearTimeout(timeout);
      this.setState("locked");
      this.onLockedCb?.();
      reject(new Error("Wallet is locked"));
      return;
    }
  }

  private setState(state: BridgeConnectionState): void {
    if (this.state !== state) {
      this.state = state;
      this.onStateChange?.(state);
    }
  }

  private nextId(): string {
    return `req-${++this.requestCounter}`;
  }

  private send(msg: OutgoingMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not connected");
    }
    this.ws.send(JSON.stringify(msg));
  }

  private request(
    msg: OutgoingMessage & { id: string },
    timeout: number,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error("Not connected to wallet"));
        return;
      }

      const id = this.nextId();
      msg.id = id;

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Request timed out"));
      }, timeout);

      this.pending.set(id, { resolve, reject, timer });

      try {
        this.send(msg);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  private handleMessage(event: MessageEvent): void {
    const raw = this.parseJson(event.data);
    if (!raw) return;

    if ("relay" in raw) return;

    const msg = raw as IncomingMessage;

    switch (msg.type) {
      case "result": {
        const req = this.pending.get(msg.id);
        if (req) {
          clearTimeout(req.timer);
          this.pending.delete(msg.id);
          req.resolve(msg.data);
        }
        break;
      }
      case "denied": {
        const req = this.pending.get(msg.id);
        if (req) {
          clearTimeout(req.timer);
          this.pending.delete(msg.id);
          req.reject(new Error(`Request denied: ${msg.reason}`));
        }
        break;
      }
      case "error": {
        const req = this.pending.get(msg.id);
        if (req) {
          clearTimeout(req.timer);
          this.pending.delete(msg.id);
          req.reject(new Error(msg.error));
        }
        break;
      }
      case "wallet_locked": {
        this.setState("locked");
        this.rejectAllPending("Wallet is locked");
        this.onLockedCb?.();
        break;
      }
    }
  }

  private handleClose(): void {
    const wasPreviouslyConnected = this.state === "connected";
    this.ws = null;
    this.identity = null;
    this.setState("disconnected");
    this.rejectAllPending("Connection closed");

    if (wasPreviouslyConnected) {
      this.onDisconnectCb?.();
    }

    if (!this.manualDisconnect && this.autoReconnect) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      return;
    }

    const delay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_DELAY,
    );
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch {
        // connect() failure will trigger handleClose → scheduleReconnect
      }
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
  }

  private rejectAllPending(reason: string): void {
    for (const [id, req] of this.pending) {
      clearTimeout(req.timer);
      req.reject(new Error(reason));
      this.pending.delete(id);
    }
  }

  private parseMessage(data: unknown): IncomingMessage | null {
    return this.parseJson(data) as IncomingMessage | null;
  }

  private parseJson(data: unknown): Record<string, unknown> | null {
    try {
      if (typeof data === "string") {
        return JSON.parse(data);
      }
      return null;
    } catch {
      return null;
    }
  }
}
