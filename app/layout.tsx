import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"] });

const siteName = "Atlas Assistant";
const description =
  "Stop doomscrolling. Start reading signal. Global news, AI summaries, and clear context in one calm news portal.";
const socialImage = {
  url: "/images/atlas-assistant-social-v1.jpg",
  width: 1200,
  height: 630,
  type: "image/jpeg",
  alt: "Atlas Assistant — Stop doomscrolling. Start reading signal. Global news. AI summaries. Clear context.",
};

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.APP_BASE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXTAUTH_URL ||
      "https://atlasassistant.rakibhq.xyz"
  ),
  title: siteName,
  description,
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "./",
    siteName,
    title: siteName,
    description,
    images: [socialImage],
  },
  twitter: {
    card: "summary_large_image",
    title: siteName,
    description,
    images: [socialImage],
  },
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icon.png", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>
          <div className="min-h-dvh">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
