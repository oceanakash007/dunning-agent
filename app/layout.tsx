import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dunning Agent – AI collections for freelancers, powered by PayPal",
  description: "Turn messy messages into PayPal invoices and let an AI agent chase payments for you.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
