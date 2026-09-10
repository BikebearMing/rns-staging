import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./custom.css";
import Custom from "./custom";
import Lava from "./lava";
import LiquidEther from "./liquid-ether";

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
        <div className="ether"><LiquidEther
          colors={["#112e33", "#1C535A", "#3d8792"]} /* lava c0/c1 plus a muted c2 — the bright #85D4E0 bloomed too hard in the fluid */
          mouseForce={19}
          cursorSize={60}
          isViscous={false}
          viscous={65}
          autoDemo
          autoSpeed={0.3}
          autoIntensity={1.1}
          isBounce
          resolution={0.35}
        /></div>
        <Lava />
        <Custom />
        {children}
      </body>
    </html>
  );
}
