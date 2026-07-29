import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { ThemeSwitcher } from "../components/ThemeSwitcher";
import "../styles/base.css";
import "../styles/landing.css";
import "../styles/docs.css";
import "../styles/themes.css";

// Applies the saved theme before first paint so there's no flash of the default.
const NO_FLASH_THEME = `(function(){try{var t=localStorage.getItem('hive-theme');if(t){document.documentElement.dataset.theme=t;}}catch(e){}})();`;

const geistSans = localFont({
  src: "./fonts/Geist-Variable.woff2",
  weight: "100 900",
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/GeistMono-Variable.woff2",
  weight: "100 900",
  variable: "--font-geist-mono",
  display: "swap",
});

const geistPixel = localFont({
  src: "./fonts/GeistPixel-Square.woff2",
  weight: "400",
  variable: "--font-geist-pixel",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Hive · Close your laptop. Your agents keep shipping.",
    template: "%s · Hive",
  },
  description:
    "Hive is a control plane for AI coding agents that you host yourself. Run Claude and Codex and Kimi in parallel across isolated git workspaces. Pick up any session from your desktop or browser or phone.",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "Hive · Close your laptop. Your agents keep shipping.",
    description:
      "A control plane for AI coding agents that you host yourself. Parallel sessions. Isolated git workspaces. Every device.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0d0d13",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${geistPixel.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME }} />
      </head>
      <body>
        {children}
        <ThemeSwitcher />
      </body>
    </html>
  );
}
