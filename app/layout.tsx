import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "neat-meet — real-time meeting assistant",
  description:
    "Live transcript, rolling summary, and shareable insights grounded in your connected knowledge.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
