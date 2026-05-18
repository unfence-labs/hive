import Foundation

func formatDuration(_ ms: Int) -> String {
    if ms < 1000 { return "\(ms)ms" }
    let seconds = Double(ms) / 1000.0
    return String(format: "%.1fs", seconds)
}

func readableActivityStatus(_ status: String) -> String {
    guard !status.isEmpty else { return status }
    let normalized = status.replacingOccurrences(of: "_", with: " ")
    let spaced = normalized.replacingOccurrences(
        of: #"([a-z])([A-Z])"#,
        with: "$1 $2",
        options: .regularExpression
    )
    return spaced.prefix(1).uppercased() + String(spaced.dropFirst())
}
