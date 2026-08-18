import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const imageUrl = `${protocol}://${host}/og.png`;

  return {
    title: "Midnight Voice Blackjack",
    description:
      "A voice-first blackjack call opened from iMessage, powered by Vapi-ready conversational audio.",
    applicationName: "Midnight Voice Blackjack",
    icons: {
      icon: "/dealer-mina.png",
      shortcut: "/dealer-mina.png",
    },
    openGraph: {
      title: "Midnight Voice Blackjack",
      description: "Text the table. Answer the call. Play blackjack with your voice.",
      type: "website",
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: "Midnight Voice Blackjack with Mina, the AI dealer",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "Midnight Voice Blackjack",
      description: "Text the table. Answer the call. Play blackjack with your voice.",
      images: [imageUrl],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#080810",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
