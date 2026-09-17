import Home from "../page";
import LiquidEther from "../liquid-ether";

// Same page on the LiquidEther background (was the homepage until 2026-09-17);
// lava.js sees this path and only runs the preloader sequencing.
export default function Ether() {
  return (
    <>
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
      <Home />
    </>
  );
}
