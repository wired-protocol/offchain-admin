# Dispute Resolution — Admin Panel & Escrow Rework

## Problem

Currently, when an escrow times out, tokens auto-refund to the seller (P2P `buyer_owner_hash`) regardless of whether a dispute is open. A malicious seller can stall a disputed trade and get auto-refunded after timeout, even if the buyer legitimately paid fiat.

## New Behavior

1. **No dispute** — escrow times out → auto-refund to seller (unchanged)
2. **Dispute opened before timeout** — escrow times out → tokens **stay locked on-chain** (`DisputedLocked` status). No note is created for anyone. A registered operator resolves manually via admin panel, which submits an `EscrowDispute` tx that creates the output note to the correct party (seller or buyer).

## Design Principles

- **Funds never leave the escrow to an intermediary** — they stay locked until resolution
- **`EscrowDispute` tx already constrains output** to only `seller_owner_hash` or `buyer_owner_hash` from that specific escrow. No operator can redirect funds elsewhere.
- **Operator registry is on-chain and dynamic** — owner (deployer) can add/remove operators via RPC. Managed through the token project UI.

---

## Phase 1: On-Chain — Operator Registry

### 1.1 Operator registry storage
- **File:** `crypto/crates/storage/src/lib.rs`
- New column family `CF_OPERATORS` — stores authorized operator public keys
- New column family `CF_CHAIN_OWNER` — stores the chain owner address (set at genesis, can transfer ownership)
- Methods:
  - `add_operator(public_key: &PublicKey) -> Result<()>`
  - `remove_operator(public_key: &PublicKey) -> Result<()>`
  - `is_operator(public_key: &PublicKey) -> Result<bool>`
  - `list_operators() -> Result<Vec<PublicKey>>`
  - `get_chain_owner() -> Result<Address>`
  - `set_chain_owner(address: &Address) -> Result<()>`

### 1.2 New transactions for operator management
- **File:** `crypto/crates/core/src/transaction.rs`
- New variants:
  ```rust
  /// Add an operator to the registry. Only chain owner can submit.
  AddOperator {
      operator_public_key: PublicKey,
      from: Address,       // must be chain owner
      nonce: Nonce,
      public_key: PublicKey,
      signature: Signature,
  }
  /// Remove an operator. Only chain owner can submit.
  RemoveOperator {
      operator_public_key: PublicKey,
      from: Address,       // must be chain owner
      nonce: Nonce,
      public_key: PublicKey,
      signature: Signature,
  }
  ```
- Add `fee()`, `nonce()`, `sender()`, `verify_signature()` impls for both

### 1.3 Execute operator management txs in node
- **File:** `crypto/node/src/main.rs`
- `AddOperator`: verify `from == chain_owner`, verify signature, call `storage.add_operator()`
- `RemoveOperator`: verify `from == chain_owner`, verify signature, call `storage.remove_operator()`

### 1.4 Set chain owner at genesis
- **File:** `crypto/crates/core/src/state.rs` (GenesisConfig)
- Add `owner_address: Option<Address>` — defaults to validator address if not set
- **File:** `crypto/node/src/main.rs` (init_genesis)
- Store owner address in `CF_CHAIN_OWNER`

### 1.5 RPC endpoints for operator registry
- **File:** `crypto/crates/rpc/src/lib.rs`
- `operator_list` → returns list of operator public keys
- `operator_isOperator(publicKey)` → bool
- `chain_getOwner` → owner address

---

## Phase 2: On-Chain — Disputed Escrow Logic

### 2.1 Add `disputed` flag to EscrowRecord
- **File:** `crypto/crates/storage/src/lib.rs`
- Add `disputed: bool` field to `EscrowRecord` (default `false`)

### 2.2 New transaction: `EscrowMarkDisputed`
- **File:** `crypto/crates/core/src/transaction.rs`
- New variant:
  ```rust
  EscrowMarkDisputed {
      escrow_id: [u8; 32],
      operator_public_key: PublicKey,
      operator_signature: Signature,
  }
  ```
- Verification in node:
  - `storage.is_operator(operator_public_key)` must be true
  - Escrow must exist and be `Locked`
  - Sets `escrow.disputed = true`

### 2.3 Change timeout logic in `produce_block`
- **File:** `crypto/node/src/main.rs` (~line 192)
- Current: timeout → create refund note to `buyer_owner_hash`, set `Refunded`
- New:
  ```
  if escrow timed out:
      if escrow.disputed:
          → do NOT create any note
          → set status to DisputedLocked
          → log: "Escrow {id} timed out with active dispute, funds locked for operator resolution"
      else:
          → create refund note to buyer_owner_hash (existing behavior)
          → set status to Refunded
  ```

### 2.4 New EscrowStatus variant
- **File:** `crypto/crates/storage/src/lib.rs`
- Add `DisputedLocked` to `EscrowStatus` — timed out + disputed, awaiting operator resolution

### 2.5 Update `EscrowDispute` tx validation
- **File:** `crypto/node/src/main.rs`
- Currently requires escrow status == `Locked`
- Change to accept `Locked` OR `DisputedLocked`
- Verify `storage.is_operator(operator_public_key)` instead of any pubkey

### 2.6 Update RPC
- **File:** `crypto/crates/rpc/src/lib.rs`
- Add `disputed: bool` to `EscrowInfo`

---

## Phase 3: Token Project — Operator Management UI

### 3.1 Add operator management RPC calls
- **File:** `token/src/lib/rpc.ts`
- `getOperators()` → `PublicKey[]`
- `getChainOwner()` → `Address`
- Use existing `rpcCall` pattern

### 3.2 New page: `/operators`
- **File:** `token/src/app/operators/page.tsx`
- Shows chain owner address
- Lists current registered operators (public key, truncated)
- **Add Operator** form: paste public key → submits `AddOperator` tx (signed by owner wallet)
- **Remove Operator** button next to each operator → submits `RemoveOperator` tx
- Only functional when connected wallet is the chain owner

### 3.3 Navigation
- Add "Operators" link to token project's nav/sidebar
- Show operator count badge

---

## Phase 4: Backend — Dispute Flagging & Admin API

### 4.1 Operator key management for backend
- **File:** `offchain/backend/src/lib/operator.ts` (new)
- Load operator Dilithium keypair from env (`OPERATOR_SEED` or `OPERATOR_PRIVATE_KEY`)
- Functions:
  - `signMarkDisputed(escrowId)` → builds + signs `EscrowMarkDisputed` tx
  - `signResolution(escrowId, resolution)` → builds + signs `EscrowDispute` tx
- Submit via `submitAndConfirm()`

### 4.2 Flag escrow on-chain when dispute is opened
- **File:** `offchain/backend/src/routes/trades.ts`
- In `POST /:id/dispute` handler, after creating offchain Dispute record:
  - If trade has an escrowId, submit `EscrowMarkDisputed` tx
  - Log success/failure (don't block the dispute creation on tx success)

### 4.3 Admin auth middleware
- **File:** `offchain/backend/src/middleware/admin-auth.ts` (new)
- Check request has valid admin auth (API key from env, or operator wallet signature)
- Protect all `/api/admin/*` routes

### 4.4 Admin API routes
- **File:** `offchain/backend/src/routes/admin.ts` (new)
- `GET /api/admin/disputes` — list disputes with filters (open, resolved, disputed_locked)
- `GET /api/admin/disputes/:id` — full detail: trade, both users, escrow on-chain state, chat history, evidence
- `POST /api/admin/disputes/:id/resolve`
  - Body: `{ resolution: "RELEASE_TO_SELLER" | "REFUND_TO_BUYER", notes: string }`
  - Calls `operator.signResolution()` → `submitAndConfirm()`
  - Updates Dispute record: resolution, resolvedBy, resolvedAt, operatorNotes
  - Updates Trade status: COMPLETED or REFUNDED
  - Notifies both parties
- `GET /api/admin/stats` — open count, resolved count, avg resolution time

### 4.5 Update Prisma schema
- **File:** `offchain/backend/prisma/schema.prisma`
- Add `DISPUTED_LOCKED` to `TradeStatus` enum
- Add `operatorAddress String?` to Dispute model

### 4.6 Update trade status transitions
- **File:** `offchain/backend/src/routes/trades.ts`
- Add transitions: `DISPUTED` → `DISPUTED_LOCKED`, `DISPUTED_LOCKED` → `COMPLETED` | `REFUNDED`
- Escrow sync service: when escrow status is `DisputedLocked`, update trade to `DISPUTED_LOCKED`

---

## Phase 5: Admin Frontend (`offchain/admin/`)

### 5.1 Project setup
- Next.js app (same stack as P2P frontend — Tailwind, shadcn/ui)
- Separate deployment, not public-facing
- Auth: API key login (matches `ADMIN_API_KEY` env in backend)

### 5.2 Pages

#### Dashboard (`/`)
- Urgent: disputes in `DISPUTED_LOCKED` state (funds locked, needs resolution)
- Open disputes count, avg resolution time, total volume disputed
- Recent activity feed

#### Disputes List (`/disputes`)
- Table: trade ID, buyer, seller, amount, token, status, opened at, timeout at
- Filters: all, open, locked (urgent), resolved
- Sort by urgency (DISPUTED_LOCKED first, then by timeout proximity)
- Color coding: red for locked, amber for open, green for resolved

#### Dispute Detail (`/disputes/:id`)
- **Trade Summary:** amount, token, payment method, timestamps, escrow tx hashes
- **Parties:** buyer address + reputation + trade count, seller same
- **Dispute Info:** reason, evidence (images/text), who filed, when
- **Chat History:** full read-only trade chat
- **On-Chain State:** escrow status, timeout timestamp, on-chain tx history
- **Resolution Actions:**
  - "Release to Seller" button → calls `POST /api/admin/disputes/:id/resolve`
  - "Refund to Buyer" button → same with opposite resolution
  - Operator notes textarea (required before resolving)
  - Confirmation modal: "You are about to release X WRD to {address}. This is irreversible."

### 5.3 Notifications
- Alert when new dispute is opened (polling or websocket from backend)
- Highlighted alert when disputed escrow reaches `DisputedLocked` (urgent)

---

## Phase 6: P2P Frontend & Wallet Updates

### 6.1 Trade page — disputed timeout state
- **File:** `offchain/frontend/src/app/trades/[id]/page.tsx`
- When trade status is `DISPUTED_LOCKED`:
  - Show: "Escrow timed out during an active dispute. An operator is reviewing your case."
  - Remove auto-refund messaging
  - Show operator resolution when available

### 6.2 Wallet escrow display
- Show `DisputedLocked` status in escrow list with appropriate badge

---

## Execution Order

1. **Phase 1** — Operator registry on-chain (storage, txs, node execution, RPC)
2. **Phase 2** — Disputed escrow logic (flag, timeout change, status)
3. **Phase 3** — Token project UI for managing operators
4. **Phase 4** — Backend operator key, admin API, dispute flagging
5. **Phase 5** — Admin frontend
6. **Phase 6** — P2P frontend + wallet updates

## Open Questions

- [ ] What happens if the operator never resolves a `DisputedLocked` escrow? Add a secondary timeout (e.g. 30 days → auto-refund to buyer as default)?
- [ ] Should evidence (screenshots, payment proofs) be stored on-chain or only offchain? (offchain is simpler, on-chain is tamper-proof)
- [ ] Multi-operator quorum for large amounts? (e.g. > 10,000 WRD requires 2/3 operators to agree)
- [ ] Should `TransferOwnership` be a separate tx so the chain owner can hand off to a multisig later?
- [ ] Rate limiting on dispute creation to prevent spam?
