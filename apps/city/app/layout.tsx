import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Porchlight",
  description: "When the grid goes dark, the porch lights stay on. An offline-first emergency network for neighbourhoods.",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = { themeColor: "#0c0f24", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
