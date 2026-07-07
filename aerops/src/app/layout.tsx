import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: { default: "AeroOps", template: "%s · AeroOps" },
  description: "AeroOps — The Operating System for Aviation.",
  applicationName: "AeroOps",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "AeroOps", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon.svg", apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0B2447" },
    { media: "(prefers-color-scheme: dark)", color: "#0B2447" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const themeInit = `
try {
  const t = localStorage.getItem("aerops-theme");
  if (t === "dark" || (!t && matchMedia("(prefers-color-scheme: dark)").matches)) {
    document.documentElement.classList.add("dark");
  }
  if (localStorage.getItem("aerops-sidebar") === "collapsed") {
    document.documentElement.dataset.sidebar = "collapsed";
  }
} catch {}
if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className={`${inter.variable} antialiased`} style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
