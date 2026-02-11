import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

interface MarkdownRendererProps {
  content: string;
}

const remarkPlugins = [remarkGfm];

const components: Components = {
  pre({ children }) {
    return <pre className="my-2 overflow-x-auto rounded-md bg-muted p-3 text-sm">{children}</pre>;
  },
  code({ className, children, ...props }) {
    const isBlock = className?.startsWith("language-");
    if (isBlock) {
      return (
        <code className={`${className ?? ""} block font-mono text-sm`} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-sm" {...props}>
        {children}
      </code>
    );
  },
  p({ children }) {
    return <p className="mb-2 last:mb-0">{children}</p>;
  },
  ul({ children }) {
    return <ul className="mb-2 ml-4 list-disc last:mb-0">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="mb-2 ml-4 list-decimal last:mb-0">{children}</ol>;
  },
  li({ children }) {
    return <li className="mb-1">{children}</li>;
  },
  a({ href, children }) {
    return (
      <a href={href} className="text-primary underline" target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  h1({ children }) {
    return <h1 className="mb-2 text-lg font-bold">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="mb-2 text-base font-bold">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="mb-1 text-sm font-bold">{children}</h3>;
  },
  blockquote({ children }) {
    return <blockquote className="border-l-2 border-muted-foreground/30 pl-3 italic">{children}</blockquote>;
  },
  table({ children }) {
    return (
      <div className="my-2 overflow-x-auto">
        <table className="w-full border-collapse text-sm">{children}</table>
      </div>
    );
  },
  th({ children }) {
    return <th className="border border-border px-2 py-1 text-left font-semibold">{children}</th>;
  },
  td({ children }) {
    return <td className="border border-border px-2 py-1">{children}</td>;
  },
};

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
      {content}
    </ReactMarkdown>
  );
}
