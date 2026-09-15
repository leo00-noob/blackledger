import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Black Ledger · Crypto Portfolio",
  description: "멀티거래소와 멀티체인 지갑을 한눈에 보는 개인용 암호화폐 자산 대시보드.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
