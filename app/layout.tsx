import type { Metadata, Viewport } from "next";
import { Caveat } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const notebookScript = Caveat({
  subsets: ["latin"],
  variable: "--font-notebook",
  display: "swap",
});

export const metadata: Metadata = {
  title: "The Enchanted Notebook",
  description: "A magical full-screen notebook that reads handwritten questions and answers with Gemini.",
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
      <body className={notebookScript.variable}>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
