import SwiftUI

/// Configuration summary and run history for one automation, read-only.
struct AutomationDetailView: View {
    let automation: Automation

    @State private var runs: [AutomationRun] = []
    @State private var selectedRun: AutomationRun?
    @State private var isLoading = true
    @State private var errorMessage: String?

    private let api = APIClient()

    var body: some View {
        List {
            Section {
                configCard
                    .listRowInsets(EdgeInsets(top: 5, leading: HiveSpacing.lg, bottom: 5, trailing: HiveSpacing.lg))
                    .listRowBackground(WhisperColor.appBackground)
                    .listRowSeparator(.hidden)
            }

            Section {
                if isLoading, runs.isEmpty {
                    ListLoadingSkeleton(rowCount: 3)
                        .listRowBackground(WhisperColor.appBackground)
                        .listRowSeparator(.hidden)
                } else if !isLoading, runs.isEmpty {
                    if let errorMessage {
                        ContentUnavailableView {
                            Label("Couldn't load runs", systemImage: "exclamationmark.triangle")
                        } description: {
                            Text(errorMessage)
                        } actions: {
                            Button("Retry") { Task { await load() } }
                                .buttonStyle(.borderedProminent)
                        }
                        .listRowBackground(WhisperColor.appBackground)
                        .listRowSeparator(.hidden)
                    } else {
                        Text("No runs yet.")
                            .font(.subheadline)
                            .foregroundStyle(WhisperColor.textSecondary)
                            .frame(maxWidth: .infinity, alignment: .center)
                            .padding(.vertical, HiveSpacing.xl)
                            .listRowBackground(WhisperColor.appBackground)
                            .listRowSeparator(.hidden)
                    }
                } else {
                    ForEach(runs) { run in
                        Button {
                            selectedRun = run
                        } label: {
                            AutomationRunRow(run: run)
                        }
                        .buttonStyle(.plain)
                        .listRowInsets(EdgeInsets(top: 4, leading: HiveSpacing.lg, bottom: 4, trailing: HiveSpacing.lg))
                        .listRowBackground(WhisperColor.appBackground)
                        .listRowSeparator(.hidden)
                    }
                }
            } header: {
                Text("Run history")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(WhisperColor.text)
                    .textCase(nil)
                    .padding(.leading, HiveSpacing.xs)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .hiveScreenBackground()
        .navigationTitle(automation.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(WhisperColor.appBackground, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .navigationDestination(item: $selectedRun) { run in
            AutomationRunLogView(automation: automation, run: run)
        }
        .refreshable { await load() }
        .task { await load() }
    }

    private var configCard: some View {
        VStack(alignment: .leading, spacing: HiveSpacing.md) {
            HStack {
                Text(AutomationFormatting.scheduleSummary(automation.trigger.expression))
                    .font(WhisperFont.scaled(16, weight: .semibold))
                    .foregroundStyle(WhisperColor.text)
                Spacer(minLength: HiveSpacing.sm)
                if !automation.enabled {
                    AutomationStatusChip(kind: .paused)
                } else if let status = automation.lastRunStatus {
                    AutomationStatusChip(kind: .status(status))
                }
            }

            Text(automation.trigger.expression)
                .font(WhisperFont.mono(12))
                .foregroundStyle(WhisperColor.codeText)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(WhisperColor.codeBg)
                )

            if let prompt = automation.action.userPromptInline, !prompt.isEmpty {
                Divider().overlay(WhisperColor.hubSeparator)
                VStack(alignment: .leading, spacing: HiveSpacing.xs) {
                    Text("Prompt")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(WhisperColor.textMuted)
                    Text(prompt)
                        .font(WhisperFont.scaled(14))
                        .foregroundStyle(WhisperColor.textSecondary)
                        .lineLimit(4)
                }
            }
        }
        .padding(HiveSpacing.lg)
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
            runs = try await api.fetchAutomationRuns(automationId: automation.id)
            errorMessage = nil
        } catch is CancellationError {
            // View disappeared.
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

private struct AutomationRunRow: View {
    let run: AutomationRun

    var body: some View {
        HStack(alignment: .center, spacing: HiveSpacing.md) {
            VStack(alignment: .leading, spacing: HiveSpacing.xs) {
                if let started = AutomationFormatting.absolute(run.startedAt) {
                    Text(started)
                        .font(WhisperFont.scaled(15, weight: .medium))
                        .foregroundStyle(WhisperColor.text)
                        .lineLimit(1)
                }
                if let summary = run.summary ?? run.error, !summary.isEmpty {
                    Text(summary)
                        .font(WhisperFont.scaled(13))
                        .foregroundStyle(run.error != nil ? WhisperColor.danger : WhisperColor.textSecondary)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: HiveSpacing.sm)

            VStack(alignment: .trailing, spacing: HiveSpacing.xs) {
                AutomationStatusChip(kind: .status(run.status))
                if let ms = run.durationMs {
                    Text(AutomationFormatting.duration(fromMs: ms))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(WhisperColor.textMuted)
                }
            }

            Image(systemName: "chevron.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(WhisperColor.textMuted)
        }
        .padding(.horizontal, HiveSpacing.md)
        .padding(.vertical, HiveSpacing.md)
        .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
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
