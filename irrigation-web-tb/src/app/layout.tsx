import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Irrigation Frontend",
  description: "Professional irrigation Web frontend with direct ThingsBoard integration",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
