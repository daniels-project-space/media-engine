"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";

const PUBLIC_PREFIXES = ["/f", "/p"];

export default function JarvisEmbed() {
  const pathname = usePathname();
  const publicSurface = PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (publicSurface) return null;

  return (
    <Script
      src="https://jarvis-orcin-six.vercel.app/jarvis-embed.js?v=universal-controls-20260719-1"
      strategy="afterInteractive"
      data-jarvis-app="media-engine"
    />
  );
}
