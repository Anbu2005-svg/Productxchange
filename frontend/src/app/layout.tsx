import type { Metadata, Viewport } from "next";
import "./globals.css";
import Navbar from "@/components/Navbar";
import PushNotificationBanner from "@/components/PushNotificationBanner";
import { ToastProvider } from "@/components/Toast";

export const metadata: Metadata = {
  title: "ProductXchange — Campus Peer-to-Peer Marketplace",
  description: "Find, exchange, rent, or donate college essentials nearby.",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#2f6b4f",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#2f6b4f" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js').catch(function() {});
                });
              }
            `,
          }}
        />
      </head>
      <body className="min-h-screen flex flex-col bg-sand dark:bg-[#131a16] text-ink dark:text-[#eaf1ed] transition-colors" style={{ fontFamily: "'Inter', sans-serif" }}>
        <ToastProvider>
          <PushNotificationBanner />
          <Navbar />
          <main className="flex-1 max-w-5xl w-full mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6">{children}</main>
          <footer className="border-t border-ink/8 dark:border-white/10 py-8 bg-sand/50 dark:bg-[#111714] text-xs text-ink/60 dark:text-stone-400 mt-12 transition-colors">
            <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-emerald-600 to-teal-600 text-white flex items-center justify-center text-xs font-bold shadow-2xs">
                  🔄
                </div>
                <span className="font-bold text-ink dark:text-white">ProductXchange</span>
                <span className="text-[11px] text-ink/40 dark:text-stone-500">• Campus Circular Economy</span>
              </div>
              <div className="flex items-center gap-4 text-xs font-medium">
                <a href="/" className="hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">Nearby</a>
                <a href="/deals" className="hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">Deals</a>
                <a href="/impact" className="hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">Eco-Impact</a>
                <a href="/chat" className="hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">Campus Chat</a>
              </div>
              <div className="text-[11px] text-ink/40 dark:text-stone-500">
                Peer-to-Peer Student Marketplace • Handshake PIN Verified
              </div>
            </div>
          </footer>
        </ToastProvider>
      </body>
    </html>
  );
}
