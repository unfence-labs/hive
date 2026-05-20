import SwiftUI

struct WorkspaceDashboardPanel: View {
    let workspace: Workspace
    let branchInfo: BranchInfo?
    let diffStats: DiffStatResponse?
    let scriptsResponse: WorkspaceScriptsResponse?
    let liveScriptStatus: [String: ScriptStatusInfo]
    let prStatus: PrStatusResponse?
    let isStreaming: Bool
    let hasUnread: Bool
    let scriptsLoadFailed: Bool

    private var branchName: String {
        branchInfo?.name ?? workspace.branch
    }

    private var activityLabel: String {
        if isStreaming { return "WORKING" }
        if hasUnread { return "UNREAD" }
        return "IDLE"
    }

    private var activityColor: Color {
        if isStreaming { return Color.accentColor }
        if hasUnread { return WhisperColor.success }
        return WhisperColor.textMuted
    }

    private var baseRefText: String {
        var parts: [String] = []
        if let defaultBranch = workspace.defaultBranch {
            parts.append("origin/\(defaultBranch)")
        }
        if let branchInfo, let syncedAt = Self.syncedTime(from: branchInfo.lastSyncedAt) {
            parts.append("synced \(syncedAt)")
        }
        return parts.joined(separator: " / ")
    }

    private var gitSummary: GitDashboardSummary {
        GitDashboardSummary(stats: diffStats)
    }

    private var scriptSummaries: [ScriptDashboardSummary] {
        ScriptDashboardSummary.build(
            config: scriptsResponse?.config,
            apiStatus: scriptsResponse?.status ?? [:],
            liveStatus: liveScriptStatus
        )
    }

    private var visibleScripts: [ScriptDashboardSummary] {
        Array(scriptSummaries.prefix(3))
    }

    private var hiddenScriptCount: Int {
        max(0, scriptSummaries.count - visibleScripts.count)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: HiveSpacing.md) {
            header

            VStack(alignment: .leading, spacing: HiveSpacing.sm) {
                gitRow
                scriptsRow
                prRow
            }
        }
        .padding(.horizontal, HiveSpacing.lg)
        .padding(.vertical, HiveSpacing.md)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(WhisperColor.hubCardFill)
                .stroke(WhisperColor.hubCardBorder, lineWidth: 0.5)
        )
        .padding(.horizontal, HiveSpacing.lg)
        .padding(.top, HiveSpacing.sm)
        .padding(.bottom, HiveSpacing.md)
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: HiveSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: HiveSpacing.sm) {
                Text(branchName)
                    .font(WhisperFont.mono(15, weight: .semibold))
                    .foregroundStyle(WhisperColor.text)
                    .lineLimit(1)
                    .truncationMode(.middle)

                Spacer(minLength: HiveSpacing.sm)

                HStack(spacing: 5) {
                    if isStreaming {
                        AgentActivityIndicator(dotSize: 2.5, spacing: 1.5)
                            .frame(width: 12, height: 10)
                    }
                    Text(activityLabel)
                        .font(.caption2.monospacedDigit().weight(.semibold))
                        .foregroundStyle(activityColor)
                }
            }

            if !baseRefText.isEmpty {
                Text(baseRefText)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(WhisperColor.textMuted)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
    }

    private var gitRow: some View {
        DashboardMetricRow(label: "git") {
            VStack(alignment: .leading, spacing: 2) {
                if gitSummary.hasChanges {
                    HStack(spacing: HiveSpacing.sm) {
                        Text("\(gitSummary.fileCount) file\(gitSummary.fileCount == 1 ? "" : "s")")
                            .foregroundStyle(WhisperColor.text)

                        Spacer(minLength: HiveSpacing.sm)

                        if gitSummary.additions > 0 {
                            Text("+\(gitSummary.additions)")
                                .foregroundStyle(WhisperColor.success)
                        }
                        if gitSummary.deletions > 0 {
                            Text("-\(gitSummary.deletions)")
                                .foregroundStyle(.red)
                        }
                    }
                    .font(.caption.monospacedDigit().weight(.medium))

                    Text("working \(gitSummary.workingCount) / branch \(gitSummary.branchCount)")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(WhisperColor.textMuted)
                } else {
                    Text("clean")
                        .font(.caption.monospacedDigit().weight(.medium))
                        .foregroundStyle(WhisperColor.success)
                }
            }
        }
    }

    private var scriptsRow: some View {
        DashboardMetricRow(label: "scripts") {
            if scriptsLoadFailed {
                Text("unavailable")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(WhisperColor.warningForeground)
            } else if scriptsResponse == nil {
                Text("loading")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(WhisperColor.textMuted)
            } else if scriptSummaries.isEmpty {
                Text("none")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(WhisperColor.textMuted)
            } else {
                HStack(spacing: HiveSpacing.sm) {
                    ForEach(visibleScripts) { script in
                        ScriptStatusToken(script: script)
                    }

                    if hiddenScriptCount > 0 {
                        Text("+\(hiddenScriptCount)")
                            .font(.caption.monospacedDigit().weight(.medium))
                            .foregroundStyle(WhisperColor.textMuted)
                    }
                }
                .lineLimit(1)
            }
        }
    }

    private var prRow: some View {
        let summary = PullRequestDashboardSummary(prStatus: prStatus)
        return DashboardMetricRow(label: "pr") {
            Text(summary.text)
                .font(.caption.monospacedDigit().weight(.medium))
                .foregroundStyle(summary.color)
                .lineLimit(1)
                .truncationMode(.tail)
        }
    }

    private static let isoWithFractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let iso: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        formatter.dateStyle = .none
        return formatter
    }()

    private static func syncedTime(from value: String) -> String? {
        let date = isoWithFractional.date(from: value) ?? iso.date(from: value)
        guard let date else { return nil }
        return timeFormatter.string(from: date)
    }
}

private struct DashboardMetricRow<Content: View>: View {
    let label: String
    let content: Content

    init(label: String, @ViewBuilder content: () -> Content) {
        self.label = label
        self.content = content()
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: HiveSpacing.md) {
            Text(label)
                .font(.caption.monospacedDigit().weight(.semibold))
                .foregroundStyle(WhisperColor.textMuted)
                .frame(width: 50, alignment: .leading)

            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct ScriptStatusToken: View {
    let script: ScriptDashboardSummary

    var body: some View {
        HStack(spacing: 4) {
            Text(script.name)
                .foregroundStyle(WhisperColor.text)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: 72, alignment: .leading)
            Text(script.statusText)
                .foregroundStyle(script.color)
        }
        .font(.caption.monospacedDigit().weight(.medium))
        .lineLimit(1)
    }
}

private struct GitDashboardSummary {
    let fileCount: Int
    let workingCount: Int
    let branchCount: Int
    let additions: Int
    let deletions: Int

    var hasChanges: Bool {
        fileCount > 0
    }

    init(stats: DiffStatResponse?) {
        guard let stats else {
            fileCount = 0
            workingCount = 0
            branchCount = 0
            additions = 0
            deletions = 0
            return
        }

        let files = Set((stats.committed + stats.uncommitted).map(\.file))
        fileCount = files.count
        workingCount = stats.uncommitted.count
        branchCount = stats.committed.count
        additions = (stats.committed + stats.uncommitted).reduce(0) { $0 + $1.additions }
        deletions = (stats.committed + stats.uncommitted).reduce(0) { $0 + $1.deletions }
    }
}

private struct ScriptDashboardSummary: Identifiable {
    let id: String
    let name: String
    let status: ScriptStatusInfo

    var statusText: String {
        switch status.state {
        case .running:
            return "run"
        case .done:
            return "ok"
        case .error:
            if let exitCode = status.exitCode {
                return "fail \(exitCode)"
            }
            return "fail"
        case .idle:
            return "idle"
        }
    }

    var color: Color {
        switch status.state {
        case .running:
            return Color.accentColor
        case .done:
            return WhisperColor.success
        case .error:
            return .red
        case .idle:
            return WhisperColor.textMuted
        }
    }

    private var priority: Int {
        switch status.state {
        case .running:
            return 0
        case .error:
            return 1
        case .done:
            return 2
        case .idle:
            return 3
        }
    }

    static func build(
        config: HiveConfig?,
        apiStatus: [String: ScriptStatusInfo],
        liveStatus: [String: ScriptStatusInfo]
    ) -> [ScriptDashboardSummary] {
        guard let scripts = config?.scripts else { return [] }

        var scriptIds: [String] = []
        if scripts.setup != nil {
            scriptIds.append("setup")
        }
        scriptIds.append(contentsOf: (scripts.run ?? [:]).keys.sorted())

        let mergedStatus = apiStatus.merging(liveStatus) { _, live in live }

        return scriptIds.map { id in
            ScriptDashboardSummary(
                id: id,
                name: id,
                status: mergedStatus[id] ?? ScriptStatusInfo(state: .idle)
            )
        }
        .sorted { lhs, rhs in
            if lhs.priority != rhs.priority {
                return lhs.priority < rhs.priority
            }
            if lhs.id == "setup" { return true }
            if rhs.id == "setup" { return false }
            return lhs.name < rhs.name
        }
    }
}

private struct PullRequestDashboardSummary {
    let text: String
    let color: Color

    init(prStatus: PrStatusResponse?) {
        guard let prStatus else {
            text = "loading"
            color = WhisperColor.textMuted
            return
        }
        if let error = prStatus.error, !error.isEmpty {
            text = "unavailable"
            color = WhisperColor.warningForeground
            return
        }
        guard let pr = prStatus.pr else {
            text = "no pr"
            color = WhisperColor.textMuted
            return
        }

        let prefix = "#\(pr.number)"
        let checks = Self.checksText(pr)

        if pr.state == .merged {
            text = "\(prefix) merged"
            color = .purple
        } else if pr.state == .closed {
            text = "\(prefix) closed"
            color = WhisperColor.textMuted
        } else if pr.state == .draft {
            text = "\(prefix) draft"
            color = WhisperColor.textMuted
        } else if pr.mergeable == false || pr.mergeableState == .conflict {
            text = "\(prefix) conflicts"
            color = WhisperColor.warningForeground
        } else if pr.checksStatus == .failure {
            text = "\(prefix) checks failed\(checks)"
            color = .red
        } else if pr.checksStatus == .cancelled {
            text = "\(prefix) checks cancelled\(checks)"
            color = WhisperColor.warningForeground
        } else if pr.checksStatus == .pending {
            text = "\(prefix) checks\(checks)"
            color = WhisperColor.warningForeground
        } else if pr.reviewStatus == .changes_requested {
            text = "\(prefix) changes requested"
            color = WhisperColor.warningForeground
        } else if pr.mergeableState == .blocked {
            text = "\(prefix) blocked"
            color = WhisperColor.warningForeground
        } else if pr.mergeableState == .unstable {
            text = "\(prefix) unstable"
            color = WhisperColor.warningForeground
        } else if pr.reviewStatus == .review_required {
            text = "\(prefix) review"
            color = .blue
        } else if pr.mergeable == true || pr.mergeableState == .clean {
            text = "\(prefix) ready"
            color = WhisperColor.success
        } else {
            text = "\(prefix) open"
            color = .blue
        }
    }

    private static func checksText(_ pr: PullRequestInfo) -> String {
        guard let passed = pr.checksPassed, let total = pr.checksTotal else { return "" }
        return " \(passed)/\(total)"
    }
}

#Preview {
    WorkspaceDashboardPanel(
        workspace: Workspace(
            id: "ws1",
            name: "algiers",
            branch: "debug-ios-build-failure",
            status: .idle,
            createdAt: "2026-05-20T10:00:00.000Z",
            activeSessionId: nil,
            projectName: "hive",
            defaultBranch: "main"
        ),
        branchInfo: BranchInfo(name: "debug-ios-build-failure", lastSyncedAt: "2026-05-20T14:32:00.000Z"),
        diffStats: DiffStatResponse(
            committed: [
                DiffFileStat(file: "ios/HiveMobile/Views/Chat/ChatView.swift", additions: 42, deletions: 8, status: .modified, renamedFrom: nil)
            ],
            uncommitted: [
                DiffFileStat(file: "ios/HiveMobile/Views/Chat/WorkspaceConversationsView.swift", additions: 86, deletions: 26, status: .modified, renamedFrom: nil)
            ]
        ),
        scriptsResponse: WorkspaceScriptsResponse(
            config: HiveConfig(
                scripts: HiveConfigScripts(setup: "npm install", run: ["dev": "npm run dev", "test": "npm test", "lint": "npm run lint"]),
                port: nil
            ),
            status: ["dev": ScriptStatusInfo(state: .running), "setup": ScriptStatusInfo(state: .done)]
        ),
        liveScriptStatus: [:],
        prStatus: PrStatusResponse(pr: nil, error: nil),
        isStreaming: true,
        hasUnread: false,
        scriptsLoadFailed: false
    )
    .frame(height: 260)
    .hiveScreenBackground()
    .preferredColorScheme(.dark)
}
