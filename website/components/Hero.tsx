"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GITHUB_URL, GitHubIcon } from "./GitHubIcon";

/**
 * The hero demo is a scripted loop: an agent works on the laptop, the lid
 * closes, the phone picks the session up, the user replies, the lid reopens.
 * Steps are cumulative. Reaching step N turns on everything up to N.
 */
const STEP_TIMES = [
  700, // 0  user message
  2100, // 1  thinking
  3600, // 2  tool: read
  5100, // 3  tool: edit
  6600, // 4  tool: tests running
  8300, // 5  tests pass
  9400, // 6  assistant reply
  11000, // 7  turn complete badge
  13400, // 8  laptop closes and recedes
  14900, // 9  phone notification
  16600, // 10 phone opens the session
  18600, // 11 reply typed on phone
  20200, // 12 reply sent, agent streams again
  23000, // 13 laptop reopens
];
const LOOP_MS = 25600;
// The mock chat builds once (steps 0..7). After that we replay only the
// close/handoff/reopen story (from step 7 onward) with the chat left fully
// populated, so it never flashes back to an empty panel.
const REPLAY_FROM = STEP_TIMES[7]; // 7000ms: turn complete, chat full
const REPLAY_LEN = LOOP_MS - REPLAY_FROM;

function useHeroStep(): number {
  const [step, setStep] = useState(-1);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStep(7); // static: finished turn on an open laptop
      return;
    }
    const start = Date.now();
    const id = window.setInterval(() => {
      const raw = Date.now() - start;
      const elapsed = raw < LOOP_MS ? raw : REPLAY_FROM + ((raw - LOOP_MS) % REPLAY_LEN);
      let current = -1;
      for (let i = 0; i < STEP_TIMES.length; i++) {
        if (elapsed >= STEP_TIMES[i]) current = i;
      }
      setStep(current);
    }, 90);
    return () => window.clearInterval(id);
  }, []);

  return step;
}

export function Hero() {
  const step = useHeroStep();
  const on = (n: number) => (step >= n ? " on" : "");
  const lidClosed = step >= 8 && step < 13;
  const phoneLive = step >= 9 && step < 13;

  return (
    <header className="hero" id="top">
      <div className="hero-bg" aria-hidden="true">
        <div className="hero-glow" />
        <div className="hero-hex" />
      </div>

      <div className="container hero-inner">
        <div className="hero-copy">
          <h1 className="hero-title">
            Close your laptop.
            <br />
            <span className="hero-title-accent">Your agents keep shipping.</span>
          </h1>
          <p className="hero-sub">
            Run parallel coding agents on a server you own. Spin up Claude, Codex, and Kimi
            in isolated git workspaces. See what each one is doing from any device. Then
            review and merge their changes.
          </p>
          <div className="hero-actions">
            <Link href="/docs" className="btn btn-primary">
              Read the docs
            </Link>
            <a href={GITHUB_URL} className="btn btn-ghost" target="_blank" rel="noreferrer">
              <GitHubIcon />
              Star on GitHub
            </a>
          </div>
          <p className="hero-note">
            Runs anywhere Node runs. Your laptop. A home server. A small VPS.
          </p>
        </div>

        <div className="hero-stage" aria-hidden="true">
          <div className={`laptop${lidClosed ? " folded" : ""}`}>
            <div className="laptop-lid">
              <div className="laptop-screen">
                <div className="window-chrome">
                  <span className="dot red" />
                  <span className="dot yellow" />
                  <span className="dot green" />
                  <span className="window-title">hive · payments-api</span>
                </div>
                <div className="window-body">
                  <aside className="mock-sidebar">
                    <p className="mock-side-label">Workspaces</p>
                    <div className="mock-ws active">
                      <span className="ws-pulse" />
                      jaipur
                    </div>
                    <div className="mock-ws">
                      <span className="ws-ok">✓</span>
                      oslo
                    </div>
                    <div className="mock-ws">
                      <span className="ws-idle" />
                      kyoto
                    </div>
                    <p className="mock-side-label brain">Brain</p>
                  </aside>
                  <div className="mock-chat">
                    <div className={`chat-user seq${on(0)}`}>
                      Fix the flaky webhook retries and add tests.
                    </div>
                    <div className={`chat-thinking seq${on(1)}`}>
                      <span className="think-dot" />
                      Thinking…
                    </div>
                    <div className={`tool-chip seq${on(2)}`}>
                      <span className="tool-kind">Read</span> src/webhooks/retry.ts
                    </div>
                    <div className={`tool-chip seq${on(3)}`}>
                      <span className="tool-kind">Edit</span> retry.ts
                      <span className="diff-add">+48</span>
                      <span className="diff-del">12 removed</span>
                    </div>
                    <div className={`tool-chip seq${on(4)}`}>
                      <span className="tool-kind">Bash</span> npm test
                      {step >= 5 ? (
                        <span className="tool-ok">✓ 42 passed</span>
                      ) : (
                        <span className="tool-spinner" />
                      )}
                    </div>
                    <div className={`chat-agent seq${on(6)}`}>
                      Retries now back off exponentially with jitter. All 42 tests pass.
                    </div>
                    <div className={`turn-badge seq${on(7)}`}>Turn complete · 4m 12s</div>
                    <div className="mock-composer">
                      Message jaipur…
                      <span className="composer-hint">⌘T new session</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="laptop-base" />
          </div>

          <div className={`phone${phoneLive ? " live" : ""}`}>
            <div className="phone-notch" />
            <div className="phone-screen">
              <div className="phone-status">
                <span>21:42</span>
                <span className="phone-carrier">Hive</span>
              </div>
              <div className={`phone-notif seq${on(9)}`}>
                <img src="/hive-logo.svg" alt="" className="phone-notif-icon" />
                <div>
                  <p className="phone-notif-title">jaipur · payments-api</p>
                  <p className="phone-notif-body">Turn complete · 42 tests passing</p>
                </div>
              </div>
              <div className={`phone-chat seq${on(10)}`}>
                <p className="phone-chat-header">jaipur · same session · full history</p>
                <div className="phone-bubble agent">
                  Retries now back off exponentially with jitter. All 42 tests pass.
                </div>
                <div className={`phone-bubble user seq${on(12)}`}>
                  Perfect. Open a PR and summarize the fix.
                </div>
                <div className={`phone-streaming seq${on(12)}`}>
                  <span className="think-dot" />
                  Agent working…
                </div>
              </div>
              <div className={`phone-composer seq${on(10)}`}>
                <span className={`phone-typed${step >= 11 && step < 12 ? " visible" : ""}`}>
                  Perfect. Open a PR…
                </span>
                {step < 11 || step >= 12 ? "Reply from anywhere" : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
