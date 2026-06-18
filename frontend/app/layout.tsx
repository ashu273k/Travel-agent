import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "TravelAI — Smart Trip Planner",
  description:
    "Describe your dream journey in plain English. Our AI agent searches, plans, and books your entire trip — flights, hotels, and activities — automatically.",
  keywords: ["travel", "AI", "trip planner", "flights", "hotels", "itinerary"],
  openGraph: {
    title: "TravelAI — Smart Trip Planner",
    description: "Describe your dream journey. Our AI handles the rest.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className={`min-h-screen antialiased ${inter.className}`}>
        {children}
      </body>
    </html>
  );
}
