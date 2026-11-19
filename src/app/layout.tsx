import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist } from "next/font/google";
import { QueryProvider } from "@/components/query-provider";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

export const metadata: Metadata = {
  title: "Veylora — Your stories, close at hand",
  description: "A thoughtful, local-first home for your series collection.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await headers();
  return (
    <html lang="en" data-theme="dark">
      <body className={geist.variable}><QueryProvider>{children}</QueryProvider></body>
    </html>
  );
}
