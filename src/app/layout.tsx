import type { Metadata, Viewport } from "next";
import { Nunito_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { THEME_PRESET_INLINE_SCRIPT } from "@/lib/theme/theme-preset-script";

const nunitoSans = Nunito_Sans({
  variable: "--font-nunito-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Monolith — Work OS",
  description:
    "Monolith — a cloud-native Work OS. Visual boards, deep hierarchy, goals, and automations in one coherent product.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Monolith",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0e10" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${nunitoSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <head>
        {/* Stamps [data-theme-preset] on <html> from localStorage while the
            document is still parsing, so a non-default preset never paints the
            keystone chrome first. Sibling of next-themes' own class script (in
            Providers); see src/lib/theme/theme-preset-script.ts. */}
        <script
          dangerouslySetInnerHTML={{ __html: THEME_PRESET_INLINE_SCRIPT }}
        />
      </head>
      <body className="flex min-h-full flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
