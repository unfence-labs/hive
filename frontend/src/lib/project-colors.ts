const AVATAR_COLORS = [
  { bg: "bg-red-500/20", text: "text-red-400" },
  { bg: "bg-orange-500/20", text: "text-orange-400" },
  { bg: "bg-amber-500/20", text: "text-amber-400" },
  { bg: "bg-emerald-500/20", text: "text-emerald-400" },
  { bg: "bg-teal-500/20", text: "text-teal-400" },
  { bg: "bg-blue-500/20", text: "text-blue-400" },
  { bg: "bg-indigo-500/20", text: "text-indigo-400" },
  { bg: "bg-purple-500/20", text: "text-purple-400" },
  { bg: "bg-pink-500/20", text: "text-pink-400" },
] as const;

export function getProjectColor(name: string) {
  let hash = 0;
  for (const ch of name) {
    hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
