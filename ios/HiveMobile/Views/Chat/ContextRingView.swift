import SwiftUI

// MARK: - Context Usage Data

struct ContextUsageData {
    let inputTokens: Int?
    let contextWindow: Int?
    let sessionCostUsd: Double?

    var usageFraction: Double? {
        guard let input = inputTokens, let window = contextWindow, window > 0 else { return nil }
        return min(1.0, Double(input) / Double(window))
    }

    var isEmpty: Bool { usageFraction == nil && sessionCostUsd == nil }

    static func derive(from messages: [ChatMessage], contextWindow: Int?) -> ContextUsageData {
        var lastInputTokens: Int?
        var totalCost: Double?

        for msg in messages.reversed() {
            if msg.role == .assistant, let tokens = msg.inputTokens, lastInputTokens == nil {
                lastInputTokens = tokens
                break
            }
        }

        for msg in messages where msg.role == .assistant {
            if let cost = msg.costUsd {
                totalCost = (totalCost ?? 0) + cost
            }
        }

        return ContextUsageData(
            inputTokens: lastInputTokens,
            contextWindow: contextWindow,
            sessionCostUsd: totalCost
        )
    }
}

// MARK: - Context Ring View

struct ContextRingView: View {
    let usage: ContextUsageData

    private var fraction: Double { usage.usageFraction ?? 0 }

    private var ringColor: Color {
        if fraction < 0.5 { return .green }
        if fraction < 0.8 { return .yellow }
        return .red
    }

    private var tooltipText: String {
        var parts: [String] = []
        if let input = usage.inputTokens, let window = usage.contextWindow {
            parts.append("\(formatTokens(input)) / \(formatTokens(window)) tokens")
        }
        if let frac = usage.usageFraction {
            parts.append("\(Int(frac * 100))%")
        }
        if let cost = usage.sessionCostUsd {
            parts.append("\(formatCost(cost)) session total")
        }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        if !usage.isEmpty {
            HStack(spacing: 4) {
                if usage.usageFraction != nil {
                    ZStack {
                        Circle()
                            .stroke(Color.secondary.opacity(0.2), lineWidth: 2)
                        Circle()
                            .trim(from: 0, to: fraction)
                            .stroke(ringColor, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                    }
                    .frame(width: 16, height: 16)
                    .animation(.easeInOut(duration: 0.3), value: fraction)
                }

                if let cost = usage.sessionCostUsd {
                    Text(formatCost(cost))
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
            }
            .help(tooltipText)
        }
    }

    private func formatTokens(_ count: Int) -> String {
        if count < 1_000 { return "\(count)" }
        if count < 100_000 { return String(format: "%.1fK", Double(count) / 1_000) }
        if count < 1_000_000 { return "\(count / 1_000)K" }
        return String(format: "%.1fM", Double(count) / 1_000_000)
    }

    private func formatCost(_ cost: Double) -> String {
        if cost < 0.01 { return String(format: "$%.3f", cost) }
        return String(format: "$%.2f", cost)
    }
}
