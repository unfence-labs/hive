import { Reveal } from "./Reveal";

const POINTS = [
  {
    title: "Any box you own",
    body: "A VPS. A home server. The Mac mini in your closet. If it runs Node and git then it runs Hive.",
  },
  {
    title: "State you can read",
    body: "Everything is files on disk. Repos and sessions and prompts and run history. There is no opaque database and no vendor export button.",
  },
  {
    title: "Locked down by default",
    body: "Token auth on the API and the WebSockets. Built in rate limiting. Reach it from anywhere over Tailscale when you want to.",
  },
  {
    title: "Yours for good",
    body: "GPLv3. Fork it. Audit it. Patch it. Your API keys talk straight to your providers. No cloud middleman sits between you and your agents.",
  },
];

export function SelfHost() {
  return (
    <section className="selfhost" id="self-host">
      <div className="container selfhost-inner">
        <div className="selfhost-copy">
          <Reveal>
            <p className="eyebrow">Run it yourself</p>
            <h2 className="section-title">
              Your server. Your keys.
              <br />
              <span className="accent-text">Your code never leaves home.</span>
            </h2>
          </Reveal>
          <ul className="selfhost-points">
            {POINTS.map((point, i) => (
              <Reveal as="li" key={point.title} delay={0.08 * i}>
                <h3>{point.title}</h3>
                <p>{point.body}</p>
              </Reveal>
            ))}
          </ul>
        </div>
        <Reveal className="selfhost-visual" delay={0.15}>
          <svg viewBox="0 0 480 380" className="topo" aria-hidden="true">
            {/* presence rings behind the server */}
            <circle className="topo-ring" cx="240" cy="78" r="46" />
            <circle className="topo-ring r2" cx="240" cy="78" r="46" />

            {/* links from the server down to each device */}
            <path className="topo-link" d="M240 120 C240 210 96 210 96 292" />
            <path className="topo-link l2" d="M240 120 L240 292" />
            <path className="topo-link l3" d="M240 120 C240 210 384 210 384 292" />

            {/* server node */}
            <rect className="topo-card" x="140" y="40" width="200" height="78" rx="14" />
            <image href="/hive-logo.svg" x="158" y="60" width="36" height="36" />
            <text className="topo-name" x="206" y="76">hive backend</text>
            <circle className="topo-live" cx="209" cy="90" r="3.4" />
            <text className="topo-meta" x="219" y="94">up 47 days</text>

            {/* keys stay on the box */}
            <rect className="topo-keys" x="250" y="26" width="92" height="24" rx="12" />
            <path
              className="topo-keys-icon"
              d="M262 38 a3.4 3.4 0 1 0 0.1 0 M265 38 h8 v3 M271 38 v3"
            />
            <text className="topo-keys-text" x="278" y="42">your keys</text>

            {/* device nodes */}
            <g className="topo-device">
              <rect x="36" y="292" width="120" height="50" rx="12" />
              <text x="96" y="322">MacBook</text>
            </g>
            <g className="topo-device">
              <rect x="180" y="292" width="120" height="50" rx="12" />
              <text x="240" y="322">iPhone</text>
            </g>
            <g className="topo-device">
              <rect x="324" y="292" width="120" height="50" rx="12" />
              <text x="384" y="322">Browser</text>
            </g>
          </svg>
        </Reveal>
      </div>
    </section>
  );
}
