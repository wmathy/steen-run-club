import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Steen Run Club",
  description:
    "Steen Run Club — personalized coaching, periodized plans, run log, and daily feedback.",
  applicationName: "Steen Run Club",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Steen Run Club",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [{ url: "/logo.png", type: "image/jpeg" }],
    apple: [{ url: "/logo.png", type: "image/jpeg" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#0b0f14",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Critical base styles so a failed/stale CSS chunk never renders a raw white page */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
              :root{--background:#0b0f14;--foreground:#e8eef6;--card:#121820;--card-border:#1e2a38;--muted:#8b9bb0;--accent:#3dd68c}
              html,body{background:#0b0f14;color:#e8eef6;margin:0;min-height:100%}
              *{box-sizing:border-box}
            `,
          }}
        />
      </head>
      <body className="flex min-h-dvh flex-col overscroll-none">{children}</body>
    </html>
  );
}
