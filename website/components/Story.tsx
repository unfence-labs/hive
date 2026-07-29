import { Reveal } from "./Reveal";

const STEPS = [
  {
    num: "01",
    title: "Launch in parallel",
    body: "Give every task its own git worktree and branch. Spin one up from scratch or from a branch or a pull request or an issue. Run up to six agent sessions in a workspace. None of them step on each other.",
  },
  {
    num: "02",
    title: "They keep running",
    body: "Hive lives on your server, not in a browser tab. Agents keep working when you close the lid. A push notification reaches you the moment one finishes or fails or needs a decision.",
  },
  {
    num: "03",
    title: "Review and merge",
    body: "Read the diffs. Comment on a line and send it straight back to the agent. Watch pull request status. Commit and push when the work is right. From your desktop or your browser.",
  },
];

export function Story() {
  return (
    <section className="story" id="how">
      <div className="container">
        <Reveal>
          <p className="eyebrow">How it works</p>
          <h2 className="section-title">
            Many agents at once. <span className="accent-text">You stay in control.</span>
          </h2>
          <p className="section-sub">
            Hive runs your agents on your own machine so they keep going when you step away.
            You review and merge on your terms.
          </p>
        </Reveal>
        <div className="story-grid">
          {STEPS.map((step, i) => (
            <Reveal key={step.num} className="story-card" delay={i * 0.12}>
              <span className="story-num">{step.num}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </Reveal>
          ))}
        </div>
        <Reveal className="story-providers" delay={0.2}>
          <p>Bring the agents you already pay for</p>
          <div className="provider-chips">
            <span className="provider-chip">
              <span className="provider-mark claude">✳</span> Claude Code
            </span>
            <span className="provider-chip">
              <span className="provider-mark codex">◎</span> Codex
            </span>
            <span className="provider-chip">
              <span className="provider-mark kimi">✦</span> Kimi K3
            </span>
            <span className="provider-note">side by side in the same workspace</span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
