import SwiftUI

struct AgentActivityList: View {
    let activities: [VisibleAgentActivity]

    var body: some View {
        if !activities.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(activities) { activity in
                    AgentActivityRow(activity: activity)
                }
            }
            .padding(.top, 2)
        }
    }
}

private struct AgentActivityRow: View {
    let activity: VisibleAgentActivity

    var body: some View {
        switch activity {
        case .diagnostic(let diagnostic):
            DiagnosticActivityRow(activity: diagnostic)
        case .unknown(let unknown):
            UnknownActivityRow(activity: unknown)
        }
    }
}

private struct DiagnosticActivityRow: View {
    let activity: AgentActivity.Diagnostic

    var body: some View {
        ActivityDisclosureRow(
            title: activity.title,
            detail: activity.method,
            trailingIcon: diagnosticIcon,
            trailingIconColor: diagnosticIconColor
        ) {
            VStack(alignment: .leading, spacing: 8) {
                Text(activity.message)
                    .font(.system(size: 12))
                    .foregroundStyle(WhisperColor.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)

                if let details = activity.details, !details.isEmpty {
                    Text(details)
                        .font(WhisperFont.mono(10))
                        .foregroundStyle(WhisperColor.textMuted)
                        .textSelection(.enabled)
                        .lineLimit(80)
                }
            }
        }
    }

    private var diagnosticIcon: String? {
        switch activity.severity {
        case .info: nil
        case .warning: "exclamationmark.triangle"
        case .error: "xmark.circle"
        }
    }

    private var diagnosticIconColor: Color {
        switch activity.severity {
        case .warning: WhisperColor.warning
        case .error: .red
        case .info: WhisperColor.textMuted
        }
    }
}

private struct UnknownActivityRow: View {
    let activity: AgentActivity.Unknown

    var body: some View {
        ActivityDisclosureRow(
            icon: "questionmark.circle",
            title: "Unsupported activity",
            detail: activity.kind
        ) {
            Text(activity.kind)
                .font(.system(size: 12))
                .foregroundStyle(WhisperColor.textMuted)
        }
    }
}

private struct ActivityDisclosureRow<Content: View>: View {
    let icon: String?
    let title: String
    var detail: String?
    var trailingIcon: String?
    var trailingIconColor = WhisperColor.textMuted
    let content: Content

    @State private var isExpanded: Bool

    init(
        icon: String? = nil,
        title: String,
        detail: String? = nil,
        trailingIcon: String? = nil,
        trailingIconColor: Color = WhisperColor.textMuted,
        @ViewBuilder content: () -> Content
    ) {
        self.icon = icon
        self.title = title
        self.detail = detail
        self.trailingIcon = trailingIcon
        self.trailingIconColor = trailingIconColor
        self.content = content()
        _isExpanded = State(initialValue: false)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isExpanded.toggle()
                }
            } label: {
                ChatActivityRowLabel(
                    icon: icon,
                    label: title,
                    detail: detail,
                    badgeText: nil,
                    trailingIcon: trailingIcon,
                    trailingIconColor: trailingIconColor,
                    isExpanded: isExpanded,
                    executing: false
                )
            }
            .buttonStyle(.plain)

            if isExpanded {
                ToolContentPanel {
                    content
                }
                .transition(.opacity)
            }
        }
    }
}
