import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Light Scout — Know Your Light Before You Arrive",
  description:
    "Enter any property address, see exactly when and where the sun hits it throughout the day. Built for real estate photographers.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <head>
        <link
          href="https://api.mapbox.com/mapbox-gl-js/v3.9.4/mapbox-gl.css"
          rel="stylesheet"
        />
      </head>
      <body className="h-full bg-zinc-950 text-white font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
