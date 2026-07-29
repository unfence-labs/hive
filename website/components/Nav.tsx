"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GITHUB_URL } from "./GitHubIcon";

export function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={`nav${scrolled ? " scrolled" : ""}`}>
      <div className="container nav-inner">
        <Link href="/" className="nav-brand">
          <img src="/hive-logo.svg" alt="" className="nav-logo" />
          <span className="nav-wordmark">Hive</span>
        </Link>
        <div className="nav-links">
          <Link href="/#how">How it works</Link>
          <Link href="/#features">Features</Link>
          <Link href="/#self-host">Hosting</Link>
          <Link href="/docs">Docs</Link>
        </div>
        <div className="nav-actions">
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="nav-github">
            GitHub
          </a>
          <Link href="/docs" className="btn btn-primary btn-sm">
            Get started
          </Link>
        </div>
      </div>
    </nav>
  );
}
