import SwiftUI

/// Read-only transcript of one automation run: header with outcome, then the
/// persisted conversation rendered with the chat's message bubbles.
struct AutomationRunLogView: View {
    let automation: Automation
    let run: AutomationRun

    @State private var log: AutomationRunLog?
    @State private var isLoading = true
    @State private var errorMessage: String?

    private let api = APIClient()

    var body: some View {
        Group {
            if isLoading {
                ConversationLoadingSkeleton()
            } else if let errorMessage {
                ContentUnavailableView {
                    Label("Couldn't load run log", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Retry") { Task { await load() } }
                        .buttonStyle(.borderedProminent)
                }
            } else if let log, !log.messages.isEmpty {
                List {
                    runHeader
                        .listRowBackground(WhisperColor.appBackground)
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets(top: HiveSpacing.sm, leading: HiveSpacing.lg, bottom: HiveSpacing.sm, trailing: HiveSpacing.lg))

                    ForEach(log.messages) { message in
                        MessageBubble(message: message)
                            .equatable()
                            .listRowBackground(WhisperColor.appBackground)
                            .listRowSeparator(.hidden)
                            .listRowInsets(EdgeInsets(top: 6, leading: HiveSpacing.lg, bottom: 6, trailing: HiveSpacing.lg))
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            } else {
                VStack(spacing: HiveSpacing.md) {
                    runHeader
                        .padding(.horizontal, HiveSpacing.lg)
                    ContentUnavailableView {
                        Label("No log for this run", systemImage: "doc.text")
                    } description: {
                        Text(run.error ?? run.summary ?? "The run produced no messages.")
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .padding(.top, HiveSpacing.sm)
            }
        }
        .hiveScreenBackground()
        .navigationTitle("Run log")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(WhisperColor.appBackground, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .task { await load() }
    }

    private var runHeader: some View {
        VStack(alignment: .leading, spacing: HiveSpacing.sm) {
            HStack(spacing: HiveSpacing.sm) {
                AutomationStatusChip(kind: .status(run.status))
                if let ms = run.durationMs {
                    Text(AutomationFormatting.duration(fromMs: ms))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(WhisperColor.textMuted)
                }
                Spacer(minLength: HiveSpacing.sm)
                if let started = AutomationFormatting.absolute(run.startedAt) {
                    Text(started)
                        .font(.caption)
                        .foregroundStyle(WhisperColor.textMuted)
                }
            }

            if let error = run.error, !error.isEmpty {
                Text(error)
                    .font(WhisperFont.mono(12))
                    .foregroundStyle(WhisperColor.danger)
                    .padding(HiveSpacing.sm)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(WhisperColor.danger.opacity(0.08))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .stroke(WhisperColor.danger.opacity(0.25), lineWidth: 0.5)
                    )
            }
        }
        .padding(HiveSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(WhisperColor.hubCardFill)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(WhisperColor.hubCardBorder, lineWidth: 0.5)
        )
    }

    private func load() async {
        do {
            log = try await api.fetchAutomationRunLog(automationId: automation.id, runId: run.id)
            errorMessage = nil
        } catch is CancellationError {
            // View disappeared.
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}
