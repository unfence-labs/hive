import SwiftUI

struct AgentActivityList: View {
    let activities: [VisibleAgentActivity]
    var showExecutingState = false

    var body: some View {
        if !activities.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(activities) { activity in
                    AgentActivityRow(activity: activity, showExecutingState: showExecutingState)
                }
            }
            .padding(.top, 2)
        }
    }
}

private struct AgentActivityRow: View {
    let activity: VisibleAgentActivity
    var showExecutingState = false

    var body: some View {
        switch activity {
        case .imageView(let image):
            ImageViewActivityRow(activity: image)
        case .imageGeneration(let image):
            ImageGenerationActivityRow(activity: image, showExecutingState: showExecutingState)
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
            trailingIconColor: diagnosticIconColor,
            expanded: AnyView(
                VStack(alignment: .leading, spacing: 8) {
                    Text(activity.message)
                        .font(WhisperFont.scaled(12))
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
            )
        )
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
            detail: activity.kind,
            expanded: AnyView(
                Text(activity.kind)
                    .font(WhisperFont.scaled(12))
                    .foregroundStyle(WhisperColor.textMuted)
            )
        )
    }
}
