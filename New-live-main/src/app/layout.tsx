import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Valentine Express — Live. Gift. Connect.",
  description: "Live streaming with gifts, chat, and creator payouts. Valentine Express Live Stream platform.",
  icons: {
    icon: "/icon.jpg",
  },
  openGraph: {
    title: "Valentine Express Live Stream",
    description: "Live. Gift. Connect.",
    images: ["/og.jpg"],
    type: "website",
  },
  other: {
    // HilltopAds site-ownership verification tag
    "67f5ac29789ff90484841abb12c2590f7f8ef301": "67f5ac29789ff90484841abb12c2590f7f8ef301",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
    children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
