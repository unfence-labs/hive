import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Check } from "lucide-react";

interface StyleDef {
  id: string;
  name: string;
  desc: string;
  tags: string[];
  sidebar: React.CSSProperties;
  sidebarText: React.CSSProperties;
  sidebarItemActive: React.CSSProperties;
  sidebarItemHover: string;
  main: React.CSSProperties;
  header: React.CSSProperties;
  headerText: React.CSSProperties;
  userBubble: React.CSSProperties;
  assistantText: React.CSSProperties;
  input: React.CSSProperties;
  inputBorder: React.CSSProperties;
  accent: string;
  palette: string[];
  badge: React.CSSProperties;
  toolCall: React.CSSProperties;
  codeBg: React.CSSProperties;
}

const styles: StyleDef[] = [
  {
    id: "terminal",
    name: "Terminal",
    desc: "Pure terminal aesthetic. Monospace, green-on-black, zero decoration. For devs who live in the shell.",
    tags: ["hacker", "minimal", "monospace"],
    sidebar: { background: "#0a0a0a", borderRight: "1px solid #1a3a1a" },
    sidebarText: { color: "#4ade80", fontFamily: "monospace", fontSize: 12 },
    sidebarItemActive: { background: "#0d2818", borderLeft: "2px solid #22c55e" },
    sidebarItemHover: "#0d2818",
    main: { background: "#000000" },
    header: { background: "#000000", borderBottom: "1px solid #1a3a1a" },
    headerText: { color: "#4ade80", fontFamily: "monospace", fontSize: 11 },
    userBubble: { background: "none", color: "#22c55e", fontFamily: "monospace", fontSize: 12, borderLeft: "2px solid #22c55e", paddingLeft: 8 },
    assistantText: { color: "#a3a3a3", fontFamily: "monospace", fontSize: 12 },
    input: { background: "#000000", color: "#4ade80", fontFamily: "monospace", fontSize: 12 },
    inputBorder: { border: "1px solid #1a3a1a", borderRadius: 0 },
    accent: "#22c55e",
    palette: ["#000000", "#0a0a0a", "#22c55e", "#4ade80", "#a3a3a3"],
    badge: { background: "#0d2818", color: "#4ade80", fontFamily: "monospace", fontSize: 9, borderRadius: 0 },
    toolCall: { background: "#0a0f0a", border: "1px solid #1a3a1a", borderRadius: 0, color: "#4ade80", fontFamily: "monospace", fontSize: 10 },
    codeBg: { background: "#0a0f0a" },
  },
  {
    id: "oled-void",
    name: "OLED Void",
    desc: "Pure black with razor-thin borders. Maximum contrast, minimum distraction. Every pixel earns its place.",
    tags: ["dark", "minimal", "OLED"],
    sidebar: { background: "#000000", borderRight: "1px solid rgba(255,255,255,0.06)" },
    sidebarText: { color: "#a1a1aa", fontSize: 12 },
    sidebarItemActive: { background: "rgba(255,255,255,0.04)" },
    sidebarItemHover: "rgba(255,255,255,0.03)",
    main: { background: "#000000" },
    header: { background: "#000000", borderBottom: "1px solid rgba(255,255,255,0.06)" },
    headerText: { color: "#e4e4e7", fontSize: 12 },
    userBubble: { background: "rgba(255,255,255,0.06)", color: "#fafafa", fontSize: 12, borderRadius: 12, padding: "8px 12px" },
    assistantText: { color: "#d4d4d8", fontSize: 12 },
    input: { background: "#000000", color: "#fafafa", fontSize: 12 },
    inputBorder: { border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10 },
    accent: "#fafafa",
    palette: ["#000000", "#18181b", "#27272a", "#a1a1aa", "#fafafa"],
    badge: { background: "rgba(255,255,255,0.06)", color: "#a1a1aa", fontSize: 9, borderRadius: 4 },
    toolCall: { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, color: "#a1a1aa", fontSize: 10 },
    codeBg: { background: "rgba(255,255,255,0.03)" },
  },
  {
    id: "cyberpunk",
    name: "Neon Circuit",
    desc: "Cyan/magenta neon on deep dark. Glowing accents, high energy. Inspired by sci-fi HUDs and dev tools.",
    tags: ["neon", "sci-fi", "vibrant"],
    sidebar: { background: "#0a0a1a", borderRight: "1px solid #1e1e3a" },
    sidebarText: { color: "#a78bfa", fontSize: 12 },
    sidebarItemActive: { background: "rgba(139,92,246,0.08)", borderLeft: "2px solid #a78bfa" },
    sidebarItemHover: "rgba(139,92,246,0.05)",
    main: { background: "#050510" },
    header: { background: "#050510", borderBottom: "1px solid #1e1e3a" },
    headerText: { color: "#e0e7ff", fontSize: 12 },
    userBubble: { background: "rgba(6,182,212,0.1)", color: "#67e8f9", fontSize: 12, borderRadius: 8, padding: "8px 12px", border: "1px solid rgba(6,182,212,0.2)" },
    assistantText: { color: "#c4b5fd", fontSize: 12 },
    input: { background: "#0a0a1a", color: "#e0e7ff", fontSize: 12 },
    inputBorder: { border: "1px solid #1e1e3a", borderRadius: 8 },
    accent: "#06b6d4",
    palette: ["#050510", "#0a0a1a", "#a78bfa", "#06b6d4", "#f0abfc"],
    badge: { background: "rgba(6,182,212,0.1)", color: "#67e8f9", fontSize: 9, borderRadius: 4 },
    toolCall: { background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.15)", borderRadius: 6, color: "#c4b5fd", fontSize: 10 },
    codeBg: { background: "rgba(139,92,246,0.06)" },
  },
  {
    id: "linear",
    name: "Linear Gradient",
    desc: "Inspired by Linear, Vercel, Raycast. Subtle gradients, glass-like surfaces, refined dark theme with purple accents.",
    tags: ["modern", "gradient", "polished"],
    sidebar: { background: "linear-gradient(180deg, #0c0c14 0%, #111119 100%)", borderRight: "1px solid rgba(255,255,255,0.06)" },
    sidebarText: { color: "#9ca3af", fontSize: 12 },
    sidebarItemActive: { background: "rgba(124,58,237,0.08)", borderLeft: "2px solid #7c3aed" },
    sidebarItemHover: "rgba(255,255,255,0.03)",
    main: { background: "#09090f" },
    header: { background: "rgba(9,9,15,0.8)", borderBottom: "1px solid rgba(255,255,255,0.06)", backdropFilter: "blur(12px)" },
    headerText: { color: "#e5e7eb", fontSize: 12 },
    userBubble: { background: "linear-gradient(135deg, rgba(124,58,237,0.15), rgba(124,58,237,0.05))", color: "#e9d5ff", fontSize: 12, borderRadius: 12, padding: "8px 14px", border: "1px solid rgba(124,58,237,0.15)" },
    assistantText: { color: "#d1d5db", fontSize: 12 },
    input: { background: "rgba(255,255,255,0.03)", color: "#e5e7eb", fontSize: 12 },
    inputBorder: { border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10 },
    accent: "#7c3aed",
    palette: ["#09090f", "#0c0c14", "#7c3aed", "#a78bfa", "#e5e7eb"],
    badge: { background: "rgba(124,58,237,0.1)", color: "#a78bfa", fontSize: 9, borderRadius: 6 },
    toolCall: { background: "rgba(124,58,237,0.05)", border: "1px solid rgba(124,58,237,0.1)", borderRadius: 8, color: "#a78bfa", fontSize: 10 },
    codeBg: { background: "rgba(255,255,255,0.03)" },
  },
  {
    id: "github-dark",
    name: "GitHub Dimmed",
    desc: "The familiar dev palette. Muted, comfortable, proven. Feels like home for anyone who stares at PRs all day.",
    tags: ["familiar", "muted", "comfortable"],
    sidebar: { background: "#161b22", borderRight: "1px solid #30363d" },
    sidebarText: { color: "#8b949e", fontSize: 12 },
    sidebarItemActive: { background: "#1f2937", borderLeft: "2px solid #58a6ff" },
    sidebarItemHover: "#1c2128",
    main: { background: "#0d1117" },
    header: { background: "#161b22", borderBottom: "1px solid #30363d" },
    headerText: { color: "#c9d1d9", fontSize: 12 },
    userBubble: { background: "#1f6feb22", color: "#c9d1d9", fontSize: 12, borderRadius: 8, padding: "8px 12px", border: "1px solid #1f6feb44" },
    assistantText: { color: "#c9d1d9", fontSize: 12 },
    input: { background: "#0d1117", color: "#c9d1d9", fontSize: 12 },
    inputBorder: { border: "1px solid #30363d", borderRadius: 8 },
    accent: "#58a6ff",
    palette: ["#0d1117", "#161b22", "#30363d", "#58a6ff", "#c9d1d9"],
    badge: { background: "#1f6feb22", color: "#58a6ff", fontSize: 9, borderRadius: 12 },
    toolCall: { background: "#161b22", border: "1px solid #30363d", borderRadius: 6, color: "#8b949e", fontSize: 10 },
    codeBg: { background: "#161b22" },
  },
  {
    id: "nord",
    name: "Arctic Nord",
    desc: "Soft frost blues on polar night. Calm, low-fatigue, harmonious. Scandinavian design meets code editor.",
    tags: ["calm", "blue", "low-fatigue"],
    sidebar: { background: "#2e3440", borderRight: "1px solid #3b4252" },
    sidebarText: { color: "#d8dee9", fontSize: 12 },
    sidebarItemActive: { background: "#3b4252" },
    sidebarItemHover: "#3b4252",
    main: { background: "#242933" },
    header: { background: "#2e3440", borderBottom: "1px solid #3b4252" },
    headerText: { color: "#eceff4", fontSize: 12 },
    userBubble: { background: "#5e81ac33", color: "#eceff4", fontSize: 12, borderRadius: 8, padding: "8px 12px", border: "1px solid #5e81ac44" },
    assistantText: { color: "#d8dee9", fontSize: 12 },
    input: { background: "#2e3440", color: "#eceff4", fontSize: 12 },
    inputBorder: { border: "1px solid #3b4252", borderRadius: 8 },
    accent: "#88c0d0",
    palette: ["#242933", "#2e3440", "#3b4252", "#88c0d0", "#eceff4"],
    badge: { background: "#88c0d022", color: "#88c0d0", fontSize: 9, borderRadius: 4 },
    toolCall: { background: "#3b4252", border: "1px solid #434c5e", borderRadius: 6, color: "#d8dee9", fontSize: 10 },
    codeBg: { background: "#2e3440" },
  },
  {
    id: "mono-paper",
    name: "Ink & Paper",
    desc: "Light mode, high contrast, zero noise. E-ink inspiration. For devs who prefer reading over decoration.",
    tags: ["light", "readable", "paper"],
    sidebar: { background: "#fafaf9", borderRight: "1px solid #e7e5e4" },
    sidebarText: { color: "#57534e", fontSize: 12 },
    sidebarItemActive: { background: "#f5f5f4", borderLeft: "2px solid #1c1917" },
    sidebarItemHover: "#f5f5f4",
    main: { background: "#fafaf9" },
    header: { background: "#fafaf9", borderBottom: "1px solid #e7e5e4" },
    headerText: { color: "#1c1917", fontSize: 12 },
    userBubble: { background: "#1c1917", color: "#fafaf9", fontSize: 12, borderRadius: 8, padding: "8px 12px" },
    assistantText: { color: "#292524", fontSize: 12, lineHeight: "1.6" },
    input: { background: "#fafaf9", color: "#1c1917", fontSize: 12 },
    inputBorder: { border: "1px solid #d6d3d1", borderRadius: 8 },
    accent: "#1c1917",
    palette: ["#fafaf9", "#f5f5f4", "#d6d3d1", "#57534e", "#1c1917"],
    badge: { background: "#f5f5f4", color: "#57534e", fontSize: 9, borderRadius: 4, border: "1px solid #e7e5e4" },
    toolCall: { background: "#f5f5f4", border: "1px solid #e7e5e4", borderRadius: 6, color: "#57534e", fontSize: 10 },
    codeBg: { background: "#f5f5f4" },
  },
  {
    id: "swiss",
    name: "Swiss Grid",
    desc: "International typographic style. Strict hierarchy, mathematical spacing, one accent. Clarity as a design principle.",
    tags: ["grid", "typography", "structured"],
    sidebar: { background: "#111111", borderRight: "2px solid #222222" },
    sidebarText: { color: "#999999", fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase" as const },
    sidebarItemActive: { background: "#1a1a1a", borderLeft: "3px solid #ff3333" },
    sidebarItemHover: "#1a1a1a",
    main: { background: "#0a0a0a" },
    header: { background: "#0a0a0a", borderBottom: "2px solid #222222" },
    headerText: { color: "#ffffff", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" as const, fontWeight: 600 },
    userBubble: { background: "none", color: "#ffffff", fontSize: 12, borderLeft: "3px solid #ff3333", paddingLeft: 12 },
    assistantText: { color: "#cccccc", fontSize: 12, lineHeight: "1.7" },
    input: { background: "#111111", color: "#ffffff", fontSize: 12, letterSpacing: "0.02em" },
    inputBorder: { border: "2px solid #222222", borderRadius: 0 },
    accent: "#ff3333",
    palette: ["#0a0a0a", "#111111", "#222222", "#ff3333", "#ffffff"],
    badge: { background: "#ff3333", color: "#ffffff", fontSize: 9, borderRadius: 0, letterSpacing: "0.05em", textTransform: "uppercase" as const },
    toolCall: { background: "#111111", border: "1px solid #222222", borderRadius: 0, color: "#999999", fontSize: 10 },
    codeBg: { background: "#111111" },
  },
  {
    id: "warm-dark",
    name: "Warm Carbon",
    desc: "Warm grays and amber accents. Less clinical than pure dark themes. Like coding by firelight.",
    tags: ["warm", "amber", "cozy"],
    sidebar: { background: "#1c1917", borderRight: "1px solid #292524" },
    sidebarText: { color: "#a8a29e", fontSize: 12 },
    sidebarItemActive: { background: "#292524", borderLeft: "2px solid #f59e0b" },
    sidebarItemHover: "#292524",
    main: { background: "#171412" },
    header: { background: "#1c1917", borderBottom: "1px solid #292524" },
    headerText: { color: "#e7e5e4", fontSize: 12 },
    userBubble: { background: "#78350f33", color: "#fef3c7", fontSize: 12, borderRadius: 10, padding: "8px 12px", border: "1px solid #92400e44" },
    assistantText: { color: "#d6d3d1", fontSize: 12 },
    input: { background: "#1c1917", color: "#e7e5e4", fontSize: 12 },
    inputBorder: { border: "1px solid #292524", borderRadius: 8 },
    accent: "#f59e0b",
    palette: ["#171412", "#1c1917", "#292524", "#f59e0b", "#e7e5e4"],
    badge: { background: "#78350f33", color: "#fbbf24", fontSize: 9, borderRadius: 4 },
    toolCall: { background: "#1c1917", border: "1px solid #292524", borderRadius: 6, color: "#a8a29e", fontSize: 10 },
    codeBg: { background: "#1c1917" },
  },
  {
    id: "brutalist",
    name: "Brutalist Raw",
    desc: "No polish, no pretense. Hard borders, system fonts, raw structure. The concrete building of UI styles.",
    tags: ["raw", "bold", "no-bs"],
    sidebar: { background: "#000000", borderRight: "3px solid #ffffff" },
    sidebarText: { color: "#ffffff", fontFamily: "monospace", fontSize: 11, textTransform: "uppercase" as const, letterSpacing: "0.08em" },
    sidebarItemActive: { background: "#ffffff", color: "#000000" },
    sidebarItemHover: "#222222",
    main: { background: "#111111" },
    header: { background: "#000000", borderBottom: "3px solid #ffffff" },
    headerText: { color: "#ffffff", fontFamily: "monospace", fontSize: 11, textTransform: "uppercase" as const, fontWeight: 700, letterSpacing: "0.1em" },
    userBubble: { background: "#ffffff", color: "#000000", fontSize: 12, fontFamily: "monospace", borderRadius: 0, padding: "8px 12px", fontWeight: 600 },
    assistantText: { color: "#cccccc", fontFamily: "monospace", fontSize: 12 },
    input: { background: "#000000", color: "#ffffff", fontFamily: "monospace", fontSize: 12 },
    inputBorder: { border: "3px solid #ffffff", borderRadius: 0 },
    accent: "#ffffff",
    palette: ["#000000", "#111111", "#333333", "#cccccc", "#ffffff"],
    badge: { background: "#ffffff", color: "#000000", fontSize: 9, fontFamily: "monospace", borderRadius: 0, fontWeight: 700, textTransform: "uppercase" as const },
    toolCall: { background: "#000000", border: "2px solid #333333", borderRadius: 0, color: "#cccccc", fontFamily: "monospace", fontSize: 10 },
    codeBg: { background: "#000000" },
  },
];

function MiniPreview({ style }: { style: StyleDef }) {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: 220,
        borderRadius: 6,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Mini sidebar */}
      <div
        style={{
          ...style.sidebar,
          width: 80,
          padding: "10px 6px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          flexShrink: 0,
        }}
      >
        <div style={{ ...style.sidebarText, fontWeight: 700, marginBottom: 6, paddingLeft: 4 }}>
          HIVE
        </div>
        <div style={{ ...style.sidebarItemActive, padding: "4px 6px", borderRadius: 3 }}>
          <div style={{ ...style.sidebarText, fontSize: 10, ...(style.id === "brutalist" ? { color: "#000" } : {}) }}>repo-1</div>
        </div>
        <div style={{ padding: "4px 6px" }}>
          <div style={{ ...style.sidebarText, fontSize: 10, opacity: 0.5 }}>repo-2</div>
        </div>
        <div style={{ padding: "4px 6px" }}>
          <div style={{ ...style.sidebarText, fontSize: 10, opacity: 0.5 }}>repo-3</div>
        </div>
        <div style={{ marginTop: "auto", borderTop: `1px solid ${style.palette[2]}22`, paddingTop: 6, paddingLeft: 4 }}>
          <div style={{ ...style.sidebarText, fontSize: 9, opacity: 0.4 }}>+ add repo</div>
        </div>
      </div>

      {/* Main area */}
      <div style={{ ...style.main, flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Header */}
        <div
          style={{
            ...style.header,
            padding: "6px 10px",
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
          }}
        >
          <span style={{ ...style.headerText }}>workspace</span>
          <span style={{ ...style.badge, padding: "1px 6px", display: "inline-flex", alignItems: "center", gap: 3 }}>
            <span style={{ width: 5, height: 5, borderRadius: style.id === "brutalist" || style.id === "terminal" || style.id === "swiss" ? 0 : "50%", background: style.accent, display: "inline-block" }} />
            active
          </span>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 8, overflow: "hidden" }}>
          {/* User message */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <div style={{ ...style.userBubble, maxWidth: "70%" }}>
              fix the auth middleware
            </div>
          </div>

          {/* Assistant message */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ ...style.assistantText }}>
              Found the issue in <span style={{ ...style.codeBg, padding: "1px 4px", borderRadius: 3, fontSize: 11 }}>auth.ts</span>. The token validation was missing the expiry check.
            </div>
            {/* Tool call */}
            <div style={{ ...style.toolCall, padding: "4px 8px", display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ opacity: 0.5 }}>Edit</span>
              <span>src/auth.ts</span>
            </div>
          </div>
        </div>

        {/* Input */}
        <div style={{ padding: "6px 10px", flexShrink: 0 }}>
          <div
            style={{
              ...style.input,
              ...style.inputBorder,
              padding: "6px 10px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={{ opacity: 0.3, fontSize: 11 }}>Send a message...</span>
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: style.id === "brutalist" || style.id === "terminal" || style.id === "swiss" ? 0 : 4,
                background: style.accent,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <span style={{ color: style.id === "mono-paper" ? "#fafaf9" : style.main.background as string, fontSize: 11, fontWeight: 700 }}>↑</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StylePreview() {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div style={{ height: "100%", overflow: "auto", background: "#09090b" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px" }}>
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <Link
            to="/projects"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              color: "#71717a",
              fontSize: 13,
              textDecoration: "none",
              marginBottom: 16,
            }}
          >
            <ArrowLeft size={14} />
            back to dashboard
          </Link>
          <h1 style={{ color: "#fafafa", fontSize: 24, fontWeight: 600, margin: 0, letterSpacing: "-0.02em" }}>
            UI Direction
          </h1>
          <p style={{ color: "#71717a", fontSize: 14, margin: "8px 0 0", lineHeight: 1.5 }}>
            Pick a direction. Each card is a miniature preview of what the sidebar, chat, and inputs would feel like.
            Click one to mark it as your choice.
          </p>
        </div>

        {/* Grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(480px, 1fr))",
            gap: 20,
          }}
        >
          {styles.map((style) => {
            const isSelected = selected === style.id;
            return (
              <button
                key={style.id}
                type="button"
                onClick={() => setSelected(isSelected ? null : style.id)}
                style={{
                  background: "#111113",
                  border: isSelected ? `2px solid ${style.accent}` : "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 12,
                  padding: 16,
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "border-color 150ms, box-shadow 150ms",
                  boxShadow: isSelected ? `0 0 20px ${style.accent}15` : "none",
                  position: "relative",
                }}
              >
                {/* Selection indicator */}
                {isSelected && (
                  <div
                    style={{
                      position: "absolute",
                      top: 12,
                      right: 12,
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: style.accent,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      zIndex: 1,
                    }}
                  >
                    <Check size={13} color={style.id === "mono-paper" ? "#fafaf9" : "#000"} strokeWidth={3} />
                  </div>
                )}

                {/* Title row */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <span style={{ color: "#fafafa", fontSize: 15, fontWeight: 600 }}>{style.name}</span>
                  <div style={{ display: "flex", gap: 3 }}>
                    {style.palette.map((color, i) => (
                      <span
                        key={i}
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          background: color,
                          border: "1px solid rgba(255,255,255,0.1)",
                        }}
                      />
                    ))}
                  </div>
                </div>

                {/* Description */}
                <p style={{ color: "#71717a", fontSize: 12, margin: "0 0 10px", lineHeight: 1.5 }}>
                  {style.desc}
                </p>

                {/* Tags */}
                <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
                  {style.tags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        background: "rgba(255,255,255,0.04)",
                        color: "#52525b",
                        fontSize: 10,
                        padding: "2px 8px",
                        borderRadius: 4,
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                {/* Preview */}
                <MiniPreview style={style} />
              </button>
            );
          })}
        </div>

        {/* Footer note */}
        <div style={{ marginTop: 32, padding: "16px 0", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <p style={{ color: "#52525b", fontSize: 12, margin: 0 }}>
            These are directional previews — the final implementation will have proper transitions, responsive layout, and theme tokens.
            Diff view styling will adapt to match the chosen direction.
          </p>
        </div>
      </div>
    </div>
  );
}
