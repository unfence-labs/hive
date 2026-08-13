import SwiftUI

/// Read-only list of the backend's scheduled automations. Mobile can inspect
/// configuration, run history, and logs; creating or editing stays on desktop.
struct AutomationsListView: View {
    @State private var automations: [Automation] = []
    @State private var selectedAutomation: Automation?
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var searchText = ""

    private let api = APIClient()

    private var filteredAutomations: [Automation] {
        guard !searchText.isEmpty else { return automations }
        return automations.filter { $0.name.localizedCaseInsensitiveContains(searchText) }
    }

    var body: some View {
        List {
            ForEach(filteredAutomations) { automation in
                Button {
                    selectedAutomation = automation
                } label: {
                    AutomationRow(automation: automation)
                }
                .buttonStyle(.plain)
                .listRowInsets(EdgeInsets(top: 5, leading: HiveSpacing.lg, bottom: 5, trailing: HiveSpacing.lg))
                .listRowBackground(WhisperColor.appBackground)
                .listRowSeparator(.hidden)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .searchable(text: $searchText, placement: .navigationBarDrawer(displayMode: .automatic))
        .hiveScreenBackground()
        .navigationTitle("Automations")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $selectedAutomation) { automation in
            AutomationDetailView(automation: automation)
        }
        .refreshable { await load() }
        .task { await load() }
        .overlay {
            if !searchText.isEmpty, filteredAutomations.isEmpty, !automations.isEmpty {
                ContentUnavailableView.search(text: searchText)
            } else if isLoading, automations.isEmpty {
                ListLoadingSkeleton()
            } else if let errorMessage, automations.isEmpty {
                ContentUnavailableView {
                    Label("Couldn't load automations", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Retry") { Task { await load() } }
                        .buttonStyle(.borderedProminent)
                }
            } else if !isLoading, automations.isEmpty {
                ContentUnavailableView {
                    Label("No automations", systemImage: "clock.arrow.2.circlepath")
                } description: {
                    Text("Create scheduled automations from the desktop app.")
                }
            }
        }
    }

    private func load() async {
        do {
            automations = try await api.fetchAutomations()
            errorMessage = nil
        } catch is CancellationError {
            // View disappeared.
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

private struct AutomationRow: View {
    let automation: Automation

    var body: some View {
        HStack(alignment: .center, spacing: HiveSpacing.md) {
            VStack(alignment: .leading, spacing: HiveSpacing.xs) {
                Text(automation.name)
                    .font(WhisperFont.scaled(16, weight: .semibold))
                    .foregroundStyle(automation.enabled ? WhisperColor.text : WhisperColor.textMuted)
                    .lineLimit(1)

                HStack(spacing: 6) {
                    Image(systemName: "clock")
                        .font(.system(size: 11))
                    Text(AutomationFormatting.scheduleSummary(automation.trigger.expression))
                        .lineLimit(1)
                }
                .font(WhisperFont.scaled(14))
                .foregroundStyle(WhisperColor.textSecondary)
            }

            Spacer(minLength: HiveSpacing.sm)

            VStack(alignment: .trailing, spacing: HiveSpacing.xs) {
                if !automation.enabled {
                    AutomationStatusChip(kind: .paused)
                } else if let status = automation.lastRunStatus {
                    AutomationStatusChip(kind: .status(status))
                } else {
                    AutomationStatusChip(kind: .never)
                }

                if let lastRunAt = automation.lastRunAt,
                   let relative = AutomationFormatting.relative(lastRunAt) {
                    Text(relative)
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(WhisperColor.textMuted)
                        .lineLimit(1)
                }
            }

            Image(systemName: "chevron.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(WhisperColor.textMuted)
        }
        .padding(.horizontal, HiveSpacing.md)
        .padding(.vertical, HiveSpacing.md)
        .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(WhisperColor.hubCardFill)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(WhisperColor.hubCardBorder, lineWidth: 0.5)
        )
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// Small status capsule shared by the automation list and run history.
struct AutomationStatusChip: View {
    enum Kind {
        case status(AutomationRunStatus)
        case paused
        case never
    }

    let kind: Kind

    var body: some View {
        HStack(spacing: 4) {
            if case .status(.running) = kind {
                AgentActivityIndicator(dotSize: 2.5, spacing: 1.2)
            } else {
                Circle()
                    .fill(dotColor)
                    .frame(width: 6, height: 6)
            }
            Text(label)
                .font(.caption2.weight(.semibold))
        }
        .foregroundStyle(foreground)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(Capsule().fill(background))
        .overlay(Capsule().stroke(border, lineWidth: 0.5))
        .accessibilityLabel("Status: \(label)")
    }

    private var label: String {
        switch kind {
        case .status(.success): "Success"
        case .status(.failure): "Failed"
        case .status(.running): "Running"
        case .paused: "Paused"
        case .never: "Never run"
        }
    }

    private var foreground: Color {
        switch kind {
        case .status(.success): WhisperColor.success
        case .status(.failure): WhisperColor.danger
        case .status(.running): WhisperColor.text
        case .paused, .never: WhisperColor.textMuted
        }
    }

    private var dotColor: Color {
        switch kind {
        case .status(.success): WhisperColor.success
        case .status(.failure): WhisperColor.danger
        case .status(.running): WhisperColor.text
        case .paused, .never: WhisperColor.textMuted
        }
    }

    private var background: Color {
        switch kind {
        case .status(.success): WhisperColor.successMuted
        case .status(.failure): WhisperColor.danger.opacity(0.12)
        case .status(.running), .paused, .never: WhisperColor.surfaceSubtle
        }
    }

    private var border: Color {
        switch kind {
        case .status(.success): WhisperColor.successBorder
        case .status(.failure): WhisperColor.danger.opacity(0.28)
        case .status(.running), .paused, .never: WhisperColor.borderSubtle
        }
    }
}

#Preview {
    NavigationStack {
        AutomationsListView()
    }
    .preferredColorScheme(.dark)
}
