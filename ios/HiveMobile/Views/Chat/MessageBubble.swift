import SwiftUI

struct MessageBubble: View {
    let message: ChatMessage

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            if message.role == .user { Spacer(minLength: 60) }

            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 4) {
                messageContent

                Text(formatTimestamp(message.timestamp))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            if message.role == .assistant { Spacer(minLength: 60) }
        }
    }

    @ViewBuilder
    private var messageContent: some View {
        switch message.role {
        case .user:
            Text(message.content)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(.accent.opacity(0.25), in: RoundedRectangle(cornerRadius: 18))
        case .assistant:
            Text(message.content)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func formatTimestamp(_ ts: String) -> String {
        // Simple display — full formatting later
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: ts) else { return "" }
        let display = DateFormatter()
        display.timeStyle = .short
        return display.string(from: date)
    }
}

#Preview {
    VStack(spacing: 16) {
        MessageBubble(message: ChatMessage(
            id: "1", sessionId: "s1", role: .user,
            content: "Can you fix the login bug?",
            images: nil, toolCalls: nil, thinkingContent: nil,
            timestamp: "2026-02-17T12:00:00.000Z", cancelled: nil, durationMs: nil
        ))
        MessageBubble(message: ChatMessage(
            id: "2", sessionId: "s1", role: .assistant,
            content: "I'll look into the authentication flow. Let me check the relevant files first.",
            images: nil, toolCalls: nil, thinkingContent: nil,
            timestamp: "2026-02-17T12:00:05.000Z", cancelled: nil, durationMs: nil
        ))
    }
    .padding()
    .preferredColorScheme(.dark)
}
