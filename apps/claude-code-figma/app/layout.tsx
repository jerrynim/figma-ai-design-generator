
import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Claude Code for Figma Designer",
  description: "AI-powered design generation tool for Figma",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
