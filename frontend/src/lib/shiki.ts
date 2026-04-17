import { createHighlighter, type Highlighter } from "shiki";

export type ShikiTheme = "github-dark" | "github-light";

let instance: Promise<Highlighter> | null = null;

function getOrCreateHighlighter() {
  if (!instance) {
    instance = createHighlighter({
      themes: ["github-dark", "github-light"],
      langs: [],
    });
  }
  return instance;
}

export async function highlightCode(
  code: string,
  lang: string,
  theme: ShikiTheme = "github-dark",
): Promise<string> {
  const highlighter = await getOrCreateHighlighter();
  const loaded = highlighter.getLoadedLanguages();
  if (!loaded.includes(lang)) {
    try {
      await highlighter.loadLanguage(lang as Parameters<Highlighter["loadLanguage"]>[0]);
    } catch {
      lang = "text";
    }
  }
  return highlighter.codeToHtml(code, {
    lang,
    theme,
    transformers: [
      {
        line(node, line) {
          node.properties["data-line"] = line;
        },
      },
    ],
  });
}
