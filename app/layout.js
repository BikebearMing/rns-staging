import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./custom.css";
import Custom from "./custom";
import Lava from "./lava";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata = {
  title: "Rebel & Soul",
  description: "Rebel & Soul",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body className="preloading">
        <link rel="stylesheet" href="https://use.typekit.net/udy6mtk.css" />
        <Lava />
        <Custom />
        {children}
      </body>
    </html>
  );
}
