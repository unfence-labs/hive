import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  DOC_SECTIONS,
  ORDERED_SLUGS,
  getDoc,
  getDocMeta,
  type DocEntry,
} from "../lib/docs";
import { Nav } from "./Nav";
import { Footer } from "./ClosingCta";

/** Server-rendered documentation page: sidebar + article + prev/next pager. */
export function DocView({ slug }: { slug: string }) {
  const doc = getDoc(slug) as DocEntry;
  const index = ORDERED_SLUGS.indexOf(slug);
  const prev = index > 0 ? getDocMeta(ORDERED_SLUGS[index - 1]) : undefined;
  const next =
    index >= 0 && index < ORDERED_SLUGS.length - 1
      ? getDocMeta(ORDERED_SLUGS[index + 1])
      : undefined;

  return (
    <div className="docs">
      <Nav />
      <div className="container docs-layout">
        <aside className="docs-sidebar">
          <nav>
            {DOC_SECTIONS.map((section) => (
              <div className="docs-nav-section" key={section.label}>
                <p className="docs-nav-label">{section.label}</p>
                {section.slugs.map((s) => {
                  const entry = getDocMeta(s);
                  if (!entry) return null;
                  return (
                    <Link
                      key={s}
                      href={`/docs/${s}`}
                      className={`docs-nav-link${s === slug ? " active" : ""}`}
                    >
                      {entry.title}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>

        <main className="docs-main">
          <article className="prose">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) => {
                  if (href?.startsWith("/docs")) {
                    return <Link href={href}>{children}</Link>;
                  }
                  const external = href?.startsWith("http");
                  return (
                    <a
                      href={href}
                      target={external ? "_blank" : undefined}
                      rel={external ? "noreferrer" : undefined}
                    >
                      {children}
                    </a>
                  );
                },
              }}
            >
              {doc.body}
            </ReactMarkdown>
          </article>

          <div className="docs-pager">
            {prev ? (
              <Link href={`/docs/${prev.slug}`} className="docs-pager-link prev">
                <span>← Previous</span>
                {prev.title}
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link href={`/docs/${next.slug}`} className="docs-pager-link next">
                <span>Next →</span>
                {next.title}
              </Link>
            ) : (
              <span />
            )}
          </div>
        </main>
      </div>
      <Footer />
    </div>
  );
}
