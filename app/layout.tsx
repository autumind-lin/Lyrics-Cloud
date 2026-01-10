import type { Metadata } from "next";
import { Manrope, ZCOOL_XiaoWei } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const xiaowei = ZCOOL_XiaoWei({
  variable: "--font-xiaowei",
  weight: ["400"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Lyrics Cloud",
  description: "私有离线中文歌词检索与可视化",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hans">
      <body className={`${manrope.variable} ${xiaowei.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
