const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

function getApiKey(): string {
  if (typeof window !== "undefined") {
    return sessionStorage.getItem("admin_key") ?? "";
  }
  return "";
}

export function setApiKey(key: string): void {
  sessionStorage.setItem("admin_key", key);
}

export function clearApiKey(): void {
  sessionStorage.removeItem("admin_key");
}

export function hasApiKey(): boolean {
  return Boolean(getApiKey());
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}/admin${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Key": getApiKey(),
      ...init.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${body}`);
  }

  return res.json() as Promise<T>;
}

// =============================================================================
// Types
// =============================================================================

export interface DisputeUser {
  id: string;
  address: string;
  displayName: string | null;
  reputation: number;
  totalTrades: number;
}

export interface Trade {
  id: string;
  amount: string;
  fiatAmount: string;
  escrowId: string | null;
  status: string;
  paymentMethod: string;
  createdAt: string;
  updatedAt: string;
  offer: { token: string; currency: string; price: string };
  buyer: DisputeUser;
  seller: DisputeUser;
  messages?: Array<{
    id: string;
    content: string;
    type: string;
    createdAt: string;
    sender: { id: string; address: string; displayName: string | null };
  }>;
}

export interface Dispute {
  id: string;
  tradeId: string;
  reason: string;
  evidence: string[];
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  operatorNotes: string | null;
  createdAt: string;
  updatedAt: string;
  trade: Trade;
  disputant: { id: string; address: string; displayName: string | null };
  onChainEscrow?: {
    escrow_id: string;
    amount: string;
    status: string;
    timeout_timestamp: number;
    disputed: boolean;
  } | null;
}

export interface AdminStats {
  openDisputes: number;
  lockedDisputes: number;
  resolvedDisputes: number;
  avgResolutionMinutes: number | null;
}

// =============================================================================
// API methods
// =============================================================================

export async function getDisputes(status?: "open" | "locked" | "resolved"): Promise<Dispute[]> {
  const qs = status ? `?status=${status}` : "";
  return apiFetch<Dispute[]>(`/disputes${qs}`);
}

export async function getDispute(id: string): Promise<Dispute> {
  return apiFetch<Dispute>(`/disputes/${id}`);
}

export async function resolveDispute(
  id: string,
  resolution: "RELEASE_TO_SELLER" | "REFUND_TO_BUYER",
  notes: string,
  signedTxHex?: string
): Promise<Dispute> {
  return apiFetch<Dispute>(`/disputes/${id}/resolve`, {
    method: "POST",
    body: JSON.stringify({ resolution, notes, signedTxHex }),
  });
}

export async function getStats(): Promise<AdminStats> {
  return apiFetch<AdminStats>("/stats");
}
