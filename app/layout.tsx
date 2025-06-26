// f:/New folder/corporate-compass-ai/app/layout.tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// This line should already be correct from the previous fix
import { SessionProviderWrapper } from "./SessionProviderWrapper"; // Import the wrapper for NextAuth session context.

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Corporate Compass AI", // Application title.
  description: "Internal Knowledge Base AI", // Application description.
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Root layout component for the entire application.
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`} // Apply Geist fonts and antialiasing.
      >
        <SessionProviderWrapper>
          {children}
        </SessionProviderWrapper>
      </body>
    </html>
  );
}
