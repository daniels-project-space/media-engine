import type { Metadata } from "next";
import { Bricolage_Grotesque, Martian_Mono } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import Shell from "@/components/shell";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  weight: ["500", "700", "800"],
});

const martian = Martian_Mono({
  subsets: ["latin"],
  variable: "--font-martian",
  weight: ["300", "400", "700"],
});

export const metadata: Metadata = {
  title: "MEDIA ENGINE — master control",
  description:
    "Unified marketing & media engine: persona growth, product ads, shorts factory, email.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${bricolage.variable} ${martian.variable} scanlines antialiased`}>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
