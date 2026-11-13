import type { Metadata, Viewport } from "next";
import "./globals.css";
import Navbar from "@/components/Navbar";
import MobileBottomNav from "@/components/MobileBottomNav";
import PwaInstallPrompt from "@/components/PwaInstallPrompt";
import OfflineBanner from "@/components/OfflineBanner";
import PushNotificationBanner from "@/components/PushNotificationBanner";
import { ToastProvider } from "@/components/Toast";

export const metadata: Metadata = {
  title: "ProductXchange — Campus Marketplace",
  description: "Peer-to-peer campus essentials with physical handshake verification.",
  manifest: "/manifest.json",
  applicationName: "ProductXchange",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ProductXchange",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
      { url: "/icons/icon.svg", type: "image/svg+xml" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#2F6B4F",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  userScalable: true,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="application-name" content="ProductXchange" />
        <meta name="format-detection" content="telephone=no" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js').then(function(reg) {
                    reg.update();
                  }).catch(function() {});
                });
              }
            `,
          }}
        />
      </head>
      <body className="min-h-screen flex flex-col bg-bg text-text antialiased">
        <ToastProvider>
          <OfflineBanner />
          <PushNotificationBanner />
          <Navbar />
          <main className="flex-1 max-w-[1200px] w-full mx-auto px-4 md:px-6 py-4 md:py-6 pb-20 md:pb-8">
            {children}
          </main>
          <footer className="border-t border-border py-6 pb-24 md:pb-6 bg-surface text-xs text-text-tertiary mt-8">
            <div className="max-w-[1200px] mx-auto px-4 md:px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-text">ProductXchange</span>
                <span>•</span>
                <span>Campus Circular Marketplace</span>
              </div>
              <div className="flex items-center gap-4 text-xs text-text-secondary">
                <a href="/" className="hover:text-text transition-colors">Nearby</a>
                <a href="/deals" className="hover:text-text transition-colors">Deals</a>
                <a href="/impact" className="hover:text-text transition-colors">Eco-Impact</a>
                <a href="/chat" className="hover:text-text transition-colors">Chat</a>
              </div>
              <div className="text-text-tertiary">
                Peer-to-peer campus verification
              </div>
            </div>
          </footer>
          <MobileBottomNav />
          <PwaInstallPrompt />
        </ToastProvider>
      </body>
    </html>
  );
}
