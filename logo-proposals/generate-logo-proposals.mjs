import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const outputDir = new URL(".", import.meta.url).pathname;
mkdirSync(outputDir, { recursive: true });

const commonDefs = `
  <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="28" stdDeviation="28" flood-color="#000000" flood-opacity="0.22"/>
  </filter>
  <filter id="tightShadow" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="16" stdDeviation="16" flood-color="#000000" flood-opacity="0.2"/>
  </filter>`;

function svg(title, body, defs = "") {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img" aria-label="${title}">
  <title>${title}</title>
  <defs>${commonDefs}${defs}</defs>
  ${body}
</svg>
`;
}

const proposals = [
  {
    slug: "01-mono-pillar-selected",
    name: "Selected Pillar",
    note: "The selected direction preserved almost as-is: strict, premium, and small-size friendly.",
    svg: svg(
      "Selected Pillar app icon",
      `
  <rect width="1024" height="1024" rx="224" fill="#F2F0EA"/>
  <rect x="278" y="190" width="468" height="644" rx="116" fill="#111111" filter="url(#softShadow)"/>
  <rect x="378" y="284" width="92" height="456" rx="44" fill="#F2F0EA"/>
  <rect x="554" y="284" width="92" height="456" rx="44" fill="#F2F0EA"/>
  <rect x="424" y="466" width="176" height="92" rx="38" fill="#F2F0EA"/>
  <circle cx="512" cy="742" r="30" fill="#FF6B35"/>`
    ),
  },
  {
    slug: "02-mono-pillar-taller",
    name: "Taller Pillar",
    note: "A more vertical silhouette with stronger app-icon presence and a smaller signal dot.",
    svg: svg(
      "Taller Pillar app icon",
      `
  <rect width="1024" height="1024" rx="224" fill="#F5F2EB"/>
  <rect x="300" y="150" width="424" height="724" rx="132" fill="#101010" filter="url(#softShadow)"/>
  <rect x="394" y="268" width="82" height="438" rx="41" fill="#F5F2EB"/>
  <rect x="548" y="268" width="82" height="438" rx="41" fill="#F5F2EB"/>
  <rect x="430" y="466" width="164" height="80" rx="36" fill="#F5F2EB"/>
  <circle cx="512" cy="760" r="23" fill="#FF6B35"/>`
    ),
  },
  {
    slug: "03-mono-pillar-squircle",
    name: "Squircle Pillar",
    note: "A calmer variant with a wider body and gentler corners.",
    svg: svg(
      "Squircle Pillar app icon",
      `
  <rect width="1024" height="1024" rx="224" fill="#EFEDE6"/>
  <rect x="250" y="210" width="524" height="604" rx="152" fill="#111111" filter="url(#tightShadow)"/>
  <rect x="370" y="312" width="88" height="394" rx="44" fill="#EFEDE6"/>
  <rect x="566" y="312" width="88" height="394" rx="44" fill="#EFEDE6"/>
  <rect x="414" y="474" width="196" height="76" rx="38" fill="#EFEDE6"/>
  <rect x="474" y="716" width="76" height="32" rx="16" fill="#FF7048"/>`
    ),
  },
  {
    slug: "04-mono-pillar-outline",
    name: "Outline Pillar",
    note: "A lighter mark that keeps the same silhouette but feels more airy and frontend-friendly.",
    svg: svg(
      "Outline Pillar app icon",
      `
  <rect width="1024" height="1024" rx="224" fill="#F7F5EF"/>
  <rect x="266" y="190" width="492" height="644" rx="126" fill="#111111" filter="url(#softShadow)"/>
  <rect x="326" y="250" width="372" height="524" rx="82" fill="#F7F5EF"/>
  <rect x="392" y="300" width="80" height="404" rx="40" fill="#111111"/>
  <rect x="552" y="300" width="80" height="404" rx="40" fill="#111111"/>
  <rect x="432" y="474" width="160" height="76" rx="38" fill="#111111"/>
  <circle cx="512" cy="724" r="24" fill="#FF6B35"/>`
    ),
  },
  {
    slug: "05-mono-pillar-cut",
    name: "Cut Pillar",
    note: "A sharper, more architectural variant with a bottom notch instead of a floating dot.",
    svg: svg(
      "Cut Pillar app icon",
      `
  <rect width="1024" height="1024" rx="224" fill="#F0EEE7"/>
  <path d="M396 186h232c74 0 134 60 134 134v372c0 74-60 134-134 134h-74l-42 54-42-54h-74c-74 0-134-60-134-134V320c0-74 60-134 134-134Z" fill="#111111" filter="url(#softShadow)"/>
  <rect x="382" y="296" width="86" height="406" rx="43" fill="#F0EEE7"/>
  <rect x="556" y="296" width="86" height="406" rx="43" fill="#F0EEE7"/>
  <rect x="425" y="472" width="174" height="80" rx="38" fill="#F0EEE7"/>
  <path d="M486 826h52l-26 34-26-34Z" fill="#FF6B35"/>`
    ),
  },
  {
    slug: "06-mono-pillar-inverted",
    name: "Inverted Pillar",
    note: "A dark-mode first version with the same premium contrast but less beige warmth.",
    svg: svg(
      "Inverted Pillar app icon",
      `
  <rect width="1024" height="1024" rx="224" fill="#111111"/>
  <rect x="278" y="190" width="468" height="644" rx="116" fill="#F5F2EB" filter="url(#softShadow)"/>
  <rect x="378" y="284" width="92" height="456" rx="44" fill="#111111"/>
  <rect x="554" y="284" width="92" height="456" rx="44" fill="#111111"/>
  <rect x="424" y="466" width="176" height="92" rx="38" fill="#111111"/>
  <circle cx="512" cy="742" r="30" fill="#FF6B35"/>`
    ),
  },
  {
    slug: "07-mono-pillar-pin",
    name: "Pin Pillar",
    note: "A more product-like take: same H, but the body reads as a location/workspace pin.",
    svg: svg(
      "Pin Pillar app icon",
      `
  <rect width="1024" height="1024" rx="224" fill="#F4F1EA"/>
  <path d="M512 146c142 0 256 108 256 242 0 184-176 372-256 488-80-116-256-304-256-488 0-134 114-242 256-242Z" fill="#111111" filter="url(#softShadow)"/>
  <rect x="384" y="286" width="84" height="348" rx="42" fill="#F4F1EA"/>
  <rect x="556" y="286" width="84" height="348" rx="42" fill="#F4F1EA"/>
  <rect x="426" y="438" width="172" height="80" rx="40" fill="#F4F1EA"/>
  <circle cx="512" cy="702" r="28" fill="#FF6B35"/>`
    ),
  },
  {
    slug: "08-mono-pillar-slab",
    name: "Slab Pillar",
    note: "The most brutalist option: flatter corners, heavier geometry, and strong favicon readability.",
    svg: svg(
      "Slab Pillar app icon",
      `
  <rect width="1024" height="1024" rx="224" fill="#F1EFE8"/>
  <rect x="260" y="190" width="504" height="644" rx="72" fill="#111111" filter="url(#softShadow)"/>
  <rect x="372" y="286" width="96" height="444" rx="34" fill="#F1EFE8"/>
  <rect x="556" y="286" width="96" height="444" rx="34" fill="#F1EFE8"/>
  <rect x="420" y="470" width="184" height="88" rx="32" fill="#F1EFE8"/>
  <rect x="480" y="744" width="64" height="64" rx="20" fill="#FF6B35"/>`
    ),
  },
  {
    slug: "09-mono-pillar-loop",
    name: "Loop Pillar",
    note: "A softer identity variant where the H is still clear but the outer form feels more continuous.",
    svg: svg(
      "Loop Pillar app icon",
      `
  <rect width="1024" height="1024" rx="224" fill="#F5F3ED"/>
  <path d="M404 180h216c80 0 146 66 146 146v372c0 80-66 146-146 146H404c-80 0-146-66-146-146V326c0-80 66-146 146-146Z" fill="#111111" filter="url(#softShadow)"/>
  <path d="M404 306v400M620 306v400M404 512h216" fill="none" stroke="#F5F3ED" stroke-width="92" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="512" cy="748" r="26" fill="#FF6B35"/>
  <circle cx="512" cy="748" r="12" fill="#111111" opacity="0.25"/>`
    ),
  },
  {
    slug: "10-mono-pillar-signal",
    name: "Signal Pillar",
    note: "A subtle agent/status variant with one accent lane instead of the original dot.",
    svg: svg(
      "Signal Pillar app icon",
      `
  <rect width="1024" height="1024" rx="224" fill="#F2F0EA"/>
  <rect x="278" y="190" width="468" height="644" rx="116" fill="#111111" filter="url(#softShadow)"/>
  <rect x="378" y="284" width="92" height="456" rx="44" fill="#F2F0EA"/>
  <rect x="554" y="284" width="92" height="456" rx="44" fill="#F2F0EA"/>
  <rect x="424" y="466" width="176" height="92" rx="38" fill="#F2F0EA"/>
  <path d="M512 674v96" stroke="#FF6B35" stroke-width="34" stroke-linecap="round"/>
  <path d="M512 238v52" stroke="#F2F0EA" stroke-width="28" stroke-linecap="round" opacity="0.42"/>`
    ),
  },
];

for (const proposal of proposals) {
  const svgPath = join(outputDir, `${proposal.slug}.svg`);
  writeFileSync(svgPath, proposal.svg);
  execFileSync("convert", [svgPath, join(outputDir, `${proposal.slug}.png`)]);
}

const pngPaths = proposals.map((proposal) => join(outputDir, `${proposal.slug}.png`));
execFileSync("montage", [
  ...pngPaths,
  "-resize",
  "220x220",
  "-background",
  "#f6f6f2",
  "-gravity",
  "center",
  "-extent",
  "260x300",
  "-tile",
  "5x2",
  "-geometry",
  "+18+18",
  join(outputDir, "contact-sheet.png"),
]);
execFileSync("montage", [
  ...pngPaths,
  "-resize",
  "64x64",
  "-background",
  "#f6f6f2",
  "-gravity",
  "center",
  "-extent",
  "96x116",
  "-tile",
  "5x2",
  "-geometry",
  "+12+12",
  join(outputDir, "contact-sheet-small.png"),
]);

const cards = proposals
  .map(
    (proposal) => `<article>
      <img src="./${proposal.slug}.svg" alt="${proposal.name}">
      <h2>${proposal.name}</h2>
      <p>${proposal.note}</p>
    </article>`
  )
  .join("\n");

writeFileSync(
  join(outputDir, "index.html"),
  `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Hive Mono Pillar Logo Proposals</title>
  <style>
    :root {
      color: #111315;
      background: #f6f6f2;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    body {
      margin: 0;
      padding: 48px;
    }
    header {
      max-width: 880px;
      margin-bottom: 32px;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 34px;
      line-height: 1.1;
    }
    header p {
      margin: 0;
      color: #50565c;
      font-size: 16px;
      line-height: 1.6;
    }
    main {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 22px;
    }
    article {
      background: #ffffff;
      border: 1px solid #e1e1dc;
      border-radius: 8px;
      padding: 16px;
    }
    img {
      display: block;
      width: 100%;
      aspect-ratio: 1;
      border-radius: 24%;
      background: #e8e8e1;
    }
    h2 {
      margin: 14px 0 6px;
      font-size: 16px;
    }
    p {
      margin: 0;
      color: #5d646b;
      font-size: 13px;
      line-height: 1.45;
    }
  </style>
</head>
<body>
  <header>
    <h1>Hive Mono Pillar Logo Proposals</h1>
    <p>Ten focused iterations based on the selected Mono Pillar direction. Each proposal includes a 1024x1024 SVG master and PNG export.</p>
  </header>
  <main>
${cards}
  </main>
</body>
</html>
`
);

writeFileSync(
  join(outputDir, "README.md"),
  `# Hive Mono Pillar Logo Proposals

Ten focused iterations based on the selected Mono Pillar direction.

Each proposal includes:

- \`.svg\`: 1024x1024 vector master
- \`.png\`: 1024x1024 raster export for quick preview and app-icon tests
- \`index.html\`: local gallery for side-by-side comparison
- \`contact-sheet.png\`: large comparison sheet
- \`contact-sheet-small.png\`: 64px readability check

## Directions

${proposals.map((proposal) => `- **${proposal.name}**: ${proposal.note}`).join("\n")}

## Practical Notes

These variants stay close to the selected black-and-cream pillar language. The main differences are outer silhouette, corner radius, accent treatment, and dark-mode behavior. The strongest candidate should remain recognizable at 64px before being promoted into the actual iOS, web, and Tauri icon sets.
`
);

const generated = readdirSync(outputDir)
  .filter((file) => /\.(svg|png|html|md)$/u.test(file))
  .sort()
  .map((file) => `- ${basename(file)}`)
  .join("\n");

console.log(`Generated Mono Pillar logo proposals in ${outputDir}\n${generated}`);
