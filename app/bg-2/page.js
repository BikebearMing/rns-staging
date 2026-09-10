import Home from "../page";

// Same page on the old lava background: lava.js runs its sim on this path,
// and the ether is hidden (display:none also pauses its sim via its own IntersectionObserver).
export default function Bg2() {
  return (
    <>
      <style>{`.ether { display: none; }`}</style>
      <Home />
    </>
  );
}
