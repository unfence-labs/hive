import SwiftUI

struct ScriptLogDestination: Hashable {
    let workspace: Workspace
    let scriptId: String
    let command: String?
    let isSetup: Bool
    let initialState: ScriptState
    let initialExitCode: Int?
}

struct ScriptLogView: View {
    let destination: ScriptLogDestination
    @Binding var navigationPath: NavigationPath

    @Environment(ProjectStore.self) private var projectStore
    @Environment(\.colorScheme) private var colorScheme

    @State private var streamer = ScriptLogStreamer()
    @State private var isNearBottom = true
    @State private var isInteracting = false
    @State private var runStartedAt: Date?
    @State private var showStopConfirm = false
    @State private var errorMessage: String?
    @State private var isBusy = false

    private let api = APIClient()

    private var workspace: Workspace { destination.workspace }
    private var scriptId: String { destination.scriptId }

    private var status: ScriptStatusInfo {
        projectStore.statusMonitor.scriptStatus(for: workspace.id)[scriptId]
            ?? ScriptStatusInfo(state: destination.initialState, exitCode: destination.initialExitCode)
    }

    private var actionKind: ScriptDashboardActionKind {
        switch status.state {
        case .running: return .stop
        case .done, .error: return .restart
        case .idle: return .start
        }
    }

    private var hasOutput: Bool {
        !streamer.lines.isEmpty || streamer.pending != nil
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(WhisperColor.separator)
            if let serverError = streamer.serverError, !hasOutput {
                streamErrorState(serverError)
            } else if status.state == .idle && !hasOutput {
                emptyState
            } else {
                transcript
            }
        }
        .hiveScreenBackground()
        .navigationTitle(scriptId)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(action: triggerAction) {
                    Label(actionTitle, systemImage: actionSystemImage)
                }
                .tint(actionKind == .stop ? WhisperColor.danger : Color.accentColor)
                .disabled(isBusy)
                .accessibilityLabel(actionTitle)
            }
        }
        .confirmationDialog("Stop \(scriptId)?", isPresented: $showStopConfirm, titleVisibility: .visible) {
            Button("Stop", role: .destructive) { performStop() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will stop the running \(scriptId) script.")
        }
        .alert("Script Error", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            if let errorMessage { Text(errorMessage) }
        }
        .onChange(of: status.state) { old, new in
            handleStateChange(from: old, to: new)
        }
        .onAppear {
            streamer.start(workspaceId: workspace.id, scriptType: scriptId)
        }
        .onDisappear {
            streamer.stop()
        }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: HiveSpacing.sm) {
            HStack(spacing: HiveSpacing.sm) {
                statusChip
                Spacer(minLength: HiveSpacing.sm)
                if status.state == .running, let runStartedAt {
                    TimelineView(.periodic(from: .now, by: 1)) { timeline in
                        Text(elapsedText(since: runStartedAt, at: timeline.date))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(WhisperColor.textMuted)
                    }
                } else if status.state == .error || status.state == .done, let exitCode = status.exitCode {
                    Text("exit \(exitCode)")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(status.state == .error ? WhisperColor.danger : WhisperColor.textMuted)
                }
            }

            if let command = destination.command, !command.isEmpty {
                Text(command)
                    .font(WhisperFont.mono(12))
                    .foregroundStyle(WhisperColor.textSecondary)
                    .lineLimit(2)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.horizontal, HiveSpacing.lg)
        .padding(.vertical, HiveSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(WhisperColor.appBackground)
    }

    private var statusChip: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(statusColor)
                .frame(width: 7, height: 7)
            Text(statusLabel)
                .font(.caption.weight(.semibold))
                .foregroundStyle(statusColor)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(
            Capsule().fill(statusColor.opacity(0.12))
        )
    }

    private var statusColor: Color {
        switch status.state {
        case .running: return Color.accentColor
        case .done: return WhisperColor.success
        case .error: return WhisperColor.danger
        case .idle: return WhisperColor.textMuted
        }
    }

    private var statusLabel: String {
        switch status.state {
        case .running: return "Running"
        case .done: return "Done"
        case .error: return "Failed"
        case .idle: return "Idle"
        }
    }

    // MARK: - Transcript

    private static let bottomAnchorID = "script-log-bottom"

    private var transcript: some View {
        ScrollViewReader { proxy in
            List {
                if streamer.truncated {
                    Text("Older output truncated")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(WhisperColor.textMuted)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .logRow()
                }

                ForEach(streamer.lines) { line in
                    lineText(line)
                        .id(line.id)
                        .logRow()
                }

                if let pending = streamer.pending {
                    lineText(pending)
                        .id(pending.id)
                        .logRow()
                }

                if let serverError = streamer.serverError {
                    Text(serverError)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(WhisperColor.danger)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .logRow()
                }

                Color.clear
                    .frame(height: 1)
                    .id(Self.bottomAnchorID)
                    .listRowInsets(EdgeInsets())
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
            }
            .listStyle(.plain)
            .environment(\.defaultMinListRowHeight, 0)
            .scrollContentBackground(.hidden)
            .background(WhisperColor.codeBlockBg)
            .textSelection(.enabled)
            .defaultScrollAnchor(.bottom, for: .initialOffset)
            .onScrollGeometryChange(for: Bool.self) { geometry in
                geometry.contentSize.height - geometry.visibleRect.maxY < 48
            } action: { _, nearBottom in
                isNearBottom = nearBottom
            }
            .onScrollPhaseChange { _, phase in
                isInteracting = phase == .tracking || phase == .interacting || phase == .decelerating
            }
            .onChange(of: streamer.lines.count) {
                followIfNeeded(proxy)
            }
            .onChange(of: streamer.pending) {
                followIfNeeded(proxy)
            }
            .overlay(alignment: .bottom) {
                if !isNearBottom {
                    jumpToBottomPill(proxy)
                }
            }
        }
    }

    private func lineText(_ line: AnsiLine) -> some View {
        let text = line.spans.reduce(Text("")) { partial, span in
            partial + Text(span.text)
                .foregroundColor(color(for: span.color))
                .fontWeight(span.bold ? .bold : .regular)
        }
        return text
            .font(WhisperFont.mono(12))
            .frame(maxWidth: .infinity, alignment: .leading)
            .textSelection(.enabled)
    }

    private func jumpToBottomPill(_ proxy: ScrollViewProxy) -> some View {
        Button {
            withAnimation(.easeOut(duration: 0.2)) {
                proxy.scrollTo(Self.bottomAnchorID, anchor: .bottom)
            }
            isNearBottom = true
        } label: {
            Image(systemName: "arrow.down")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(WhisperColor.text)
                .padding(10)
                .background(
                    Circle()
                        .fill(WhisperColor.surfaceRaised)
                        .overlay(Circle().stroke(WhisperColor.border, lineWidth: 0.5))
                )
                .shadow(color: .black.opacity(0.15), radius: 6, y: 2)
        }
        .padding(.bottom, HiveSpacing.lg)
        .accessibilityLabel("Scroll to latest output")
        .transition(.scale.combined(with: .opacity))
    }

    private func followIfNeeded(_ proxy: ScrollViewProxy) {
        guard isNearBottom, !isInteracting else { return }
        proxy.scrollTo(Self.bottomAnchorID, anchor: .bottom)
    }

    // MARK: - Empty state

    private var emptyState: some View {
        VStack(spacing: HiveSpacing.lg) {
            Image(systemName: "terminal")
                .font(.system(size: 40))
                .foregroundStyle(WhisperColor.textMuted)
            Text("This script hasn't run yet")
                .font(.subheadline)
                .foregroundStyle(WhisperColor.textSecondary)
            Button {
                performStart()
            } label: {
                Label("Run", systemImage: "play.fill")
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, HiveSpacing.lg)
                    .padding(.vertical, HiveSpacing.sm)
            }
            .buttonStyle(.borderedProminent)
            .disabled(isBusy)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WhisperColor.codeBlockBg)
    }

    private func streamErrorState(_ message: String) -> some View {
        VStack(spacing: HiveSpacing.lg) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 40))
                .foregroundStyle(WhisperColor.textMuted)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(WhisperColor.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WhisperColor.codeBlockBg)
    }

    // MARK: - Actions

    private var actionTitle: String {
        switch actionKind {
        case .start: return "Run"
        case .stop: return "Stop"
        case .restart: return "Restart"
        }
    }

    private var actionSystemImage: String {
        switch actionKind {
        case .start: return "play.fill"
        case .stop: return "stop.fill"
        case .restart: return "arrow.clockwise"
        }
    }

    private func triggerAction() {
        switch actionKind {
        case .start: performStart()
        case .stop: showStopConfirm = true
        case .restart: performRestart()
        }
    }

    private func performStart() {
        runAction {
            try await api.startWorkspaceScript(workspaceId: workspace.id, scriptId: scriptId)
            streamer.reconnectFresh()
        }
    }

    private func performStop() {
        runAction {
            try await api.stopWorkspaceScript(workspaceId: workspace.id, scriptId: scriptId)
        }
    }

    private func performRestart() {
        runAction {
            do {
                try await api.stopWorkspaceScript(workspaceId: workspace.id, scriptId: scriptId)
            } catch APIError.httpError(let statusCode, _) where statusCode == 409 {
            }
            try await api.startWorkspaceScript(workspaceId: workspace.id, scriptId: scriptId)
            streamer.reconnectFresh()
        }
    }

    private func runAction(_ work: @escaping () async throws -> Void) {
        guard !isBusy else { return }
        isBusy = true
        Task {
            defer { isBusy = false }
            do {
                try await work()
                projectStore.statusMonitor.forceRefresh()
            } catch is CancellationError {
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func handleStateChange(from old: ScriptState, to new: ScriptState) {
        if old != .running && new == .running {
            runStartedAt = Date()
            streamer.reconnectFresh()
        } else if new != .running {
            runStartedAt = nil
        }
        if old == .running && new == .done {
            Haptics.notify(.success)
        } else if old == .running && new == .error {
            Haptics.notify(.error)
        }
    }

    private func elapsedText(since start: Date, at date: Date) -> String {
        let total = max(0, Int(date.timeIntervalSince(start)))
        let minutes = total / 60
        let seconds = total % 60
        return minutes > 0 ? "\(minutes)m \(String(format: "%02d", seconds))s" : "\(seconds)s"
    }

    // MARK: - ANSI colors

    private func color(for token: AnsiColorToken) -> Color {
        switch token {
        case .standard:
            return WhisperColor.codeText
        case .indexed(let index):
            let palette = colorScheme == .dark ? Self.darkPalette : Self.lightPalette
            guard index >= 0 && index < palette.count else { return WhisperColor.codeText }
            return palette[index]
        }
    }

    private static let darkPalette: [Color] = [
        hex(0x7A828F), hex(0xFF6B68), hex(0x4CD964), hex(0xE3C74B),
        hex(0x6CA8FF), hex(0xD9A6FF), hex(0x56D4DD), hex(0xD5DAE2),
        hex(0x9AA1AD), hex(0xFF8A87), hex(0x6EE787), hex(0xF2CC60),
        hex(0x85B7FF), hex(0xE4BBFF), hex(0x7FE7EF), hex(0xFFFFFF),
    ]

    private static let lightPalette: [Color] = [
        hex(0x24252C), hex(0xCF222E), hex(0x116329), hex(0x8A6D00),
        hex(0x0550AE), hex(0x8250DF), hex(0x0B6E7A), hex(0x6E7781),
        hex(0x57606A), hex(0xA40E26), hex(0x1A7F37), hex(0x7A4E00),
        hex(0x0969DA), hex(0x6639BA), hex(0x1B6E78), hex(0x8C959F),
    ]

    private static func hex(_ value: UInt32) -> Color {
        Color(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}

private extension View {
    func logRow() -> some View {
        self
            .listRowInsets(EdgeInsets(top: 1, leading: HiveSpacing.lg, bottom: 1, trailing: HiveSpacing.lg))
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
    }
}
