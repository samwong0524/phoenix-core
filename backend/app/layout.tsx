import "./globals.css";
import { RegisterSW } from "./register-sw";

export const metadata = {
  title: "SWARM IDE",
  description: "Multi-agent collaboration platform",
  manifest: "/manifest.json",
  themeColor: "#0a0a0a",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "SWARM" },
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    viewportFit: "cover",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Exo+2:wght@400;500;600;700&family=Orbitron:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <meta name="theme-color" content="#0a0a0a" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="SWARM" />
      </head>
      <body>
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
