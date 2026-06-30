import "./globals.css";
import { cookies } from "next/headers";
import { RegisterSW } from "./register-sw";
import { I18nProvider } from "@/lib/i18n/context";
import { QuickPickHost } from "./_components/quickpick-host";
import { AuthGuard } from "./_components/auth-guard";
import { ConfirmProvider } from "./_components/confirm-dialog";
import { AppLayout } from "./_components/app-layout";

export const metadata = {
  title: "SWARM IDE",
  description: "Multi-agent collaboration platform",
  manifest: "/manifest.json",
};

export function generateViewport() {
  return {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    viewportFit: "cover",
    themeColor: "#0a0a0a",
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const locale = cookieStore.get("swarm-locale")?.value ?? "zh";

  return (
    <html lang={locale}>
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
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-cyan-500 focus:text-black focus:rounded focus:text-sm focus:font-medium"
        >
          Skip to content
        </a>
        <I18nProvider>
          <ConfirmProvider>
            <AuthGuard>
              <AppLayout>
                {children}
              </AppLayout>
            </AuthGuard>
          </ConfirmProvider>
          <RegisterSW />
          <QuickPickHost />
        </I18nProvider>
      </body>
    </html>
  );
}
