import Foundation

/// Canonical compact token format, shared by the context ring and the goal panel.
/// Mirrors `frontend/src/lib/format-usage.ts` `formatTokenCount`:
/// 842 → "842", 15200 → "15.2k", 123456 → "123k", 1500000 → "1.5m".
func compactTokenCount(_ count: Int) -> String {
    if count < 1_000 { return "\(count)" }
    if count < 100_000 { return String(format: "%.1fk", Double(count) / 1_000) }
    if count < 1_000_000 {
        let thousands = Int((Double(count) / 1_000).rounded())
        // Rounding can push e.g. 999_999 up to 1000k — roll over to millions.
        if thousands >= 1_000 { return "1.0m" }
        return "\(thousands)k"
    }
    return String(format: "%.1fm", Double(count) / 1_000_000)
}
