import Link from "next/link";
import { Reveal } from "./Reveal";
import { GITHUB_URL, GitHubIcon } from "./GitHubIcon";

export function ClosingCta() {
  return (
    <section className="closing">
      <div className="closing-glow" aria-hidden="true" />
      <div className="container">
        <Reveal>
          <h2 className="closing-title">
            Stop babysitting
            <br />
            your agents.
          </h2>
          <p className="closing-sub">Give them a home that outlives your browser tab.</p>
          <div className="hero-actions closing-actions">
            <a href={GITHUB_URL} className="btn btn-primary" target="_blank" rel="noreferrer">
              <GitHubIcon />
              Get Hive on GitHub
            </a>
            <Link href="/docs" className="btn btn-ghost">
              Read the docs
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <div className="footer-brand">
          <img src="/hive-logo.svg" alt="" className="nav-logo" />
          <div>
            <p className="nav-wordmark">Hive</p>
            <p className="footer-tag">Orchestrate AI coding agents from anywhere.</p>
          </div>
        </div>
        <div className="footer-links">
          <Link href="/docs">Docs</Link>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href={`${GITHUB_URL}/issues`} target="_blank" rel="noreferrer">
            Issues
          </a>
          <a href={`${GITHUB_URL}/blob/main/LICENSE`} target="_blank" rel="noreferrer">
            License · GPLv3
          </a>
        </div>
        <p className="footer-note">
          Built with <span className="footer-heart">♥</span> for people who run many agents at
          once.
        </p>
      </div>
    </footer>
  );
}
