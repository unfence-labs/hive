import Foundation

func formatDuration(_ ms: Int) -> String {
    if ms < 1000 { return "\(ms)ms" }
    let seconds = Double(ms) / 1000.0
    return String(format: "%.1fs", seconds)
}
