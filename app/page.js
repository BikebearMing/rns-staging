import Staircase from "./staircase";

// sections below the video showreel are hidden until they are ready
const SHOW_WIP = false;

export default function Home() {
  return (
    <main>
      {/* star dust for the sections BELOW the hero (the hero has the neuron
          field in its own canvas); fades in as the hero scrolls off */}
      <canvas className="stars" aria-hidden />
      <section className="section hero">
        {/* Lives inside the pinned hero: identical while pinned, scrolls away
            with it after — later sections sit straight on the lava. */}
        <Staircase />
        <h1 className="h1">
          {/* .line = GSAP exit layer; inner span = CSS entrance layer (blur/mask/sheen) */}
          <span className="line">
            <span>Attention Fades.</span>
          </span>
          <span className="line shift">
            <span>Memories Last.</span>
          </span>
        </h1>
        {/* enters as the h1 wipe (1.2s–3.65s) lands, just before the sheen */}
        <p className="body" data-text-reveal data-text-reveal-delay="4.5">
          We design brand experience, engineered to be remembered.
        </p>
      </section>
      <div className="scroll-hint mono">SCROLL</div>
      <section className="section about">
        <p className="h5 subhead" data-text-reveal>WHO WE ARE</p>
        <h2 className="h2" data-blur-reveal>
          We are The Memory Makers. We design brand experiences engineered to
          be remembered. Built on neuroscience. Made to be felt. And for every
          memory we create, we give one back to a community that needs it most.
        </h2>
      </section>
      <section className="section video-section">
        <div className="video-frame">
          <video src="/video/reel.mp4" muted playsInline loop preload="metadata" />
          <button className="unmute mono" type="button">UNMUTE</button>
        </div>
      </section>
      {SHOW_WIP && (<>
      <section className="section clients">
        {/* whole block wears the dark gradient (clipped to the text);
            .active overrides with the bright animated one. Mastercard is
            active on arrival; hover moves it and swaps the awards list. */}
        <h2 className="clients-list" aria-label="Clients">
          {["HSBC", "Mastercard", "Diageo", "JLL", "Heineken", "Visa",
            "Jaguar Land Rover", "Johnnie Walker"].map((name, i) => (
            <span key={name}>
              {i > 0 && " / "}
              <span className={`client${name === "Mastercard" ? " active" : ""}`} data-client={name}>
                {name}
              </span>
            </span>
          ))}
        </h2>
        <div className="awards">
          <p className="h5 mono awards-label">AWARDS</p>
          <ul className="awards-list body">
            <li>2025 Marketing-Interactive Agency of the Year Singapore</li>
            <li>Marketing-Interactive Agency of the Year 2020</li>
            <li>British Chamber of Commerce Singapore, 19th Annual Business Awards</li>
            <li>MARKies Awards 2021</li>
            <li>Marketing Events Awards 2023</li>
          </ul>
        </div>
      </section>
      <section className="section services">
        <div className="services-intro">
          <p className="h5 subhead" data-text-reveal>OUR SERVICES</p>
          <h3 className="h4 services-title">From concept<br />to execution.</h3>
          <button className="mono view-all" type="button">VIEW ALL</button>
        </div>
        {/* Strategy active on arrival; hover moves the focus — inactive rows
            blur back, the active one gets its bullet + thumbnail */}
        <ul className="services-list">
          {["Strategy", "Creative", "Marketing", "Events"].map((s, i) => (
            <li key={s} className={`service${i === 0 ? " active" : ""}`}>
              <span className="h3 service-name">{s}</span>
              <img className="service-thumb" src={`/stair/${i + 1}.jpg`} alt="" />
            </li>
          ))}
        </ul>
      </section>
      <section className="section work">
        <p className="h5 subhead work-label" data-text-reveal>OUR WORK</p>
        {/* full-bleed triptych; images parallax on scroll (initWork) */}
        <div className="work-grid">
          {[
            ["Johnnie Walker Vault,", "The Couture Blend"],
            ["Mastercard x McLaren:", "Singapore Grand Prix 2025"],
            ["Diageo: Johnnie Walker", "Blue Label, Depth Of Blue"],
          ].map(([l1, l2], i) => (
            <figure className="work-item" key={i}>
              <img src={`/work/${i + 1}.jpg`} alt="" />
              <figcaption className="work-caption">{l1}<br />{l2}</figcaption>
            </figure>
          ))}
        </div>
      </section>
      {/* mock: 30px side padding, 32px off the bottom; locations sit 37px
          above the wordmark, the social pip 50px above the meta line */}
      <footer className="footer">
        <div>
          <p className="mono footer-locations">SINGAPORE / UK / UAE</p>
          <img className="footer-logo" src="/rns-logo.svg" alt="Rebel &amp; Soul" />
        </div>
        <div className="footer-right">
          <a className="footer-social mono" href="https://www.linkedin.com/company/rebel-and-soul/"
             target="_blank" rel="noreferrer" aria-label="LinkedIn">in</a>
          <p className="footer-meta">
            <span className="body">© Rebel and Soul. All rights reserved 2026</span>
            <a className="body" href="#">Privacy policy</a>
          </p>
        </div>
      </footer>
      </>)}
    </main>
  );
}
