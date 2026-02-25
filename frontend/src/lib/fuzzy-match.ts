export interface FuzzyResult {
  path: string;
  basename: string;
  score: number;
}

function getBasename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function fuzzyCharMatch(text: string, query: string): number {
  let qi = 0;
  for (let ti = 0; ti < text.length && qi < query.length; ti++) {
    if (text[ti].toLowerCase() === query[qi].toLowerCase()) qi++;
  }
  return qi === query.length ? 1 : 0;
}

export function fuzzyMatchFiles(files: string[], query: string, limit = 15): FuzzyResult[] {
  if (!query) {
    return files.slice(0, limit).map((path) => ({
      path,
      basename: getBasename(path),
      score: 0,
    }));
  }

  const lowerQuery = query.toLowerCase();
  const results: FuzzyResult[] = [];

  for (const path of files) {
    const basename = getBasename(path);
    const lowerBasename = basename.toLowerCase();
    const lowerPath = path.toLowerCase();

    let score = 0;

    if (lowerBasename === lowerQuery) {
      score = 100;
    } else if (lowerBasename.startsWith(lowerQuery)) {
      score = 80;
    } else if (lowerBasename.includes(lowerQuery)) {
      score = 60;
    } else if (lowerPath.includes(lowerQuery)) {
      score = 40;
    } else if (fuzzyCharMatch(lowerPath, lowerQuery)) {
      score = 20;
    }

    if (score > 0) {
      results.push({ path, basename, score });
    }
  }

  results.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
  return results.slice(0, limit);
}

export function disambiguateDisplayName(selectedPath: string, allFiles: string[]): string {
  const basename = getBasename(selectedPath);
  const duplicates = allFiles.filter((f) => getBasename(f) === basename);
  if (duplicates.length <= 1) return basename;

  const selectedParts = selectedPath.split("/");
  for (let depth = 2; depth <= selectedParts.length; depth++) {
    const candidate = selectedParts.slice(-depth).join("/");
    const others = duplicates.filter((f) => f !== selectedPath);
    const isUnique = others.every((f) => {
      const parts = f.split("/");
      return parts.slice(-depth).join("/") !== candidate;
    });
    if (isUnique) return candidate;
  }

  return selectedPath;
}
