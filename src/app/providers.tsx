"use client";

import { type ReactNode } from "react";
import { WalletBridgeProvider } from "@/lib/bridge/react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <WalletBridgeProvider appName="Wired Admin">
      {children}
    </WalletBridgeProvider>
  );
}
