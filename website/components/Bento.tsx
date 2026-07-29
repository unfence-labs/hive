import { Reveal } from "./Reveal";

export function Bento() {
  return (
    <section className="bento" id="features">
      <div className="container">
        <Reveal>
          <p className="eyebrow">Features</p>
          <h2 className="section-title">
            Everything a fleet of agents needs.
            <br />
            <span className="accent-text">Nothing you have to babysit.</span>
          </h2>
        </Reveal>

        <div className="bento-grid">
          <Reveal className="bento-card wide">
            <div className="bento-visual worktree-visual">
              <svg viewBox="0 0 320 120" className="worktree-svg" aria-hidden="true">
                <path className="wt-main" d="M20 60 H300" />
                <path className="wt-branch b1" d="M60 60 C90 60 90 24 120 24 H290" />
                <path className="wt-branch b2" d="M100 60 C130 60 130 96 160 96 H290" />
                <circle cx="20" cy="60" r="5" className="wt-node main" />
                <circle cx="60" cy="60" r="4" className="wt-node" />
                <circle cx="100" cy="60" r="4" className="wt-node" />
                <circle cx="290" cy="24" r="5" className="wt-node hot" />
                <circle cx="290" cy="96" r="5" className="wt-node hot" />
                <text x="230" y="14" className="wt-label">workspace/jaipur</text>
                <text x="230" y="114" className="wt-label">workspace/oslo</text>
                <text x="255" y="52" className="wt-label dim">main</text>
              </svg>
            </div>
            <h3>Isolated by design</h3>
            <p>
              Projects are bare repositories. Every workspace is a real git worktree on its
              own branch. Agents commit and run tests and break things in total isolation.
              Your own checkout is never the battlefield.
            </p>
          </Reveal>

          <Reveal className="bento-card" delay={0.08}>
            <div className="bento-visual stream-visual">
              <div className="stream-ticker">
                {[...STREAM_EVENTS, ...STREAM_EVENTS].map((event, i) => (
                  <div className="stream-row" key={i}>
                    <span className={`stream-kind ${event.kind}`}>{event.label}</span>
                    <span className="stream-text">{event.text}</span>
                  </div>
                ))}
              </div>
            </div>
            <h3>Live everything</h3>
            <p>
              Every kind of activity streams live over one multiplexed WebSocket. Text and
              thinking. Tool calls and file edits. Diffs and plans and tasks and
              diagnostics. All of it reaches every connected device at once.
            </p>
          </Reveal>

          <Reveal className="bento-card" delay={0.05}>
            <div className="bento-visual terminal-visual">
              <div className="mini-term">
                <p><span className="term-prompt">jaipur %</span> npm test</p>
                <p className="term-ok">✓ 42 passed <span className="term-dim">(3.2s)</span></p>
                <p><span className="term-prompt">jaipur %</span><span className="term-cursor" /></p>
              </div>
            </div>
            <h3>Real dev tools</h3>
            <p>
              A full login shell terminal in every workspace. A file browser. Inline diffs
              you can comment on. Scripts that run with live output. Pull request status at
              a glance.
            </p>
          </Reveal>

          <Reveal className="bento-card" delay={0.1}>
            <div className="bento-visual cron-visual">
              <div className="cron-row">
                <span className="cron-expr">0 7 * * 1-5</span>
                <span className="cron-name">Morning triage</span>
              </div>
              <div className="cron-runs">
                <span className="run-dot ok" />
                <span className="run-dot ok" />
                <span className="run-dot fail" />
                <span className="run-dot ok" />
                <span className="run-dot running" />
              </div>
            </div>
            <h3>Agents on a schedule</h3>
            <p>
              Define reusable Team agents with their own model and system prompt and read
              only mode. Run them against any project on a cron schedule. You get full run
              history and summaries and failure alerts.
            </p>
          </Reveal>

          <Reveal className="bento-card" delay={0.12}>
            <div className="bento-visual brain-visual">
              <div className="brain-note">
                <p className="brain-note-title"># decisions/billing.md</p>
                <p className="brain-note-line">Stripe webhooks retry with</p>
                <p className="brain-note-line">exponential backoff since…</p>
                <span className="brain-save">Save → commit + push</span>
              </div>
            </div>
            <h3>A Brain that persists</h3>
            <p>
              One shared knowledge base backed by git. Chat with it. Let agents read it.
              Edit Markdown notes and push the whole thing as commits you can audit.
            </p>
          </Reveal>

          <Reveal className="bento-card wide" delay={0.14}>
            <div className="bento-visual devices-visual">
              <div className="device-pill">Desktop · Tauri</div>
              <div className="device-link" />
              <div className="device-pill accent">One backend</div>
              <div className="device-link" />
              <div className="device-pill">Web · iOS</div>
            </div>
            <h3>Every device is a real client</h3>
            <p>
              The Tauri desktop app and the web UI and the native SwiftUI iOS client all
              speak the same REST and WebSocket protocols. Start a session on one. Finish it
              on another. Push notifications keep you in the loop.
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

const STREAM_EVENTS = [
  { kind: "text", label: "text", text: "Refactoring the retry queue…" },
  { kind: "think", label: "think", text: "The backoff cap should be…" },
  { kind: "tool", label: "tool", text: "Edit src/webhooks/retry.ts" },
  { kind: "diff", label: "diff", text: "48 added · 12 removed" },
  { kind: "tool", label: "tool", text: "Bash npm test" },
  { kind: "plan", label: "plan", text: "Step 3 of 4 · add jitter tests" },
  { kind: "text", label: "text", text: "All 42 tests are passing." },
  { kind: "task", label: "task", text: "Open a PR with a summary" },
];
