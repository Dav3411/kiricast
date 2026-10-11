import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Noto_Sans_KR, Space_Grotesk, Poppins } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { LocaleProvider } from "@/components/LocaleProvider";
import { JobQueueProvider } from "@/components/JobQueueProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const notoSansKR = Noto_Sans_KR({
  variable: "--font-noto-sans-kr",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
});

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const viewport: Viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'dark',
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "Kiricast - Turn your ideas into real stories in minutes.",
  description: "Build stories with AI. Create AI audio dramas with unique characters, share with the world.",
  icons: {
    icon: "/icon.svg",
  },
  openGraph: {
    title: "Kiricast - Turn your ideas into real stories in minutes.",
    description: "Build stories with AI. Create AI audio dramas with unique characters, share with the world.",
    type: "website",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${notoSansKR.variable} ${spaceGrotesk.variable} ${poppins.variable} antialiased`}
      >
        <NextIntlClientProvider messages={messages}>
          <AuthProvider>
            <LocaleProvider>
              <JobQueueProvider>{children}</JobQueueProvider>
            </LocaleProvider>
          </AuthProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
