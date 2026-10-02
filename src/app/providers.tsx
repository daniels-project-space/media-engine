"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useMemo } from "react";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://blissful-sardine-231.convex.cloud";

export default function Providers({ children }: { children: React.ReactNode }) {
  const client = useMemo(
    () => new ConvexReactClient(CONVEX_URL),
    [],
  );
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
