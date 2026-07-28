import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const headerList = await headers();
  const host =
    headerList.get("x-forwarded-host") ??
    headerList.get("host") ??
    "localhost:3000";
  const protocol =
    headerList.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const baseUrl = new URL(`${protocol}://${host}`);

  return {
    metadataBase: baseUrl,
    title: "月末拾光｜照片省纸排版",
    description:
      "导入照片、按毫米设置尺寸，支持多种常用纸张，自动旋转混排并一键导出 300 DPI 打印 PDF。",
    openGraph: {
      title: "月末拾光｜照片省纸排版",
      description: "多种纸张 · 自动省纸 · 一键 PDF",
      type: "website",
      locale: "zh_CN",
      images: [
        {
          url: new URL("/og-v2.png", baseUrl).toString(),
          width: 1200,
          height: 630,
          alt: "月末拾光 A4 照片排版工具",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "月末拾光｜照片省纸排版",
      description: "多种纸张 · 自动省纸 · 一键 PDF",
      images: [new URL("/og-v2.png", baseUrl).toString()],
    },
  };
}

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
