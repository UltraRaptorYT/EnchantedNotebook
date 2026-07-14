import type { Metadata, Viewport } from "next";
import { Caveat } from "next/font/google";
import "./globals.css";

const diaryScript = Caveat({
  subsets: ["latin"],
  variable: "--font-diary",
  display: "swap",
});

export const metadata: Metadata = {
  title: "The Enchanted Notebook",
  description: "A magical full-screen diary that reads handwritten questions and answers with Gemini.",
};

export const viewport: Viewport = {
  themeColor: "#e7e4dc",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={diaryScript.variable}>{children}</body>
    </html>
  );
}
