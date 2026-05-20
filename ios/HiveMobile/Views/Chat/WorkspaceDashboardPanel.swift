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

    private var activityAccessibilityLabel: String {
        if isStreaming { return "Working" }
        if hasUnread { return "Unread" }
        return "Idle"
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

    private var prSummary: PullRequestDashboardSummary {
        PullRequestDashboardSummary(prStatus: prStatus)
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
        VStack(alignment: .leading, spacing: HiveSpacing.lg) {
            header
            gitSummaryBlock
            scriptsBlock
        }
        .padding(.horizontal, HiveSpacing.lg)
        .padding(.vertical, HiveSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .topLeading)
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
        HStack(alignment: .top, spacing: HiveSpacing.md) {
            VStack(alignment: .leading, spacing: 6) {
                Text(branchName)
                    .font(WhisperFont.mono(17, weight: .semibold))
                    .foregroundStyle(WhisperColor.text)
                    .lineLimit(2)
                    .truncationMode(.middle)

                if !baseRefText.isEmpty {
                    Text(baseRefText)
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(WhisperColor.textMuted)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }

            Spacer(minLength: HiveSpacing.sm)

            DashboardActivityIcon(
                isStreaming: isStreaming,
                hasUnread: hasUnread,
                accessibilityLabel: activityAccessibilityLabel
            )
        }
    }

    private var gitSummaryBlock: some View {
        VStack(alignment: .leading, spacing: HiveSpacing.sm) {
            DashboardSectionTitle(title: "Workspace")

            HStack(alignment: .top, spacing: 0) {
                DashboardStatColumn(
                    title: "Files",
                    value: gitSummary.filesValue,
                    detail: gitSummary.filesDetail,
                    valueColor: gitSummary.filesColor
                )

                DashboardDivider()

                DashboardStatColumn(
                    title: "Changes",
                    value: gitSummary.changesValue,
                    detail: gitSummary.changesDetail,
                    valueColor: gitSummary.changesColor
                )

                DashboardDivider()

                DashboardStatColumn(
                    title: "Pull Request",
                    value: prSummary.title,
                    detail: prSummary.detail,
                    valueColor: prSummary.color
                )
            }
            .padding(.vertical, HiveSpacing.sm)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(WhisperColor.surfaceSubtle)
            )
        }
    }

    private var scriptsBlock: some View {
        VStack(alignment: .leading, spacing: HiveSpacing.sm) {
            DashboardSectionTitle(title: "Scripts")

            if scriptsLoadFailed {
                DashboardEmptyLine(text: "Script status unavailable", color: WhisperColor.warningForeground)
            } else if scriptsResponse == nil {
                DashboardEmptyLine(text: "Loading scripts", color: WhisperColor.textMuted)
            } else if scriptSummaries.isEmpty {
                DashboardEmptyLine(text: "No scripts configured", color: WhisperColor.textMuted)
            } else {
                LazyVGrid(
                    columns: [
                        GridItem(.flexible(), spacing: HiveSpacing.sm),
                        GridItem(.flexible(), spacing: HiveSpacing.sm)
                    ],
                    alignment: .leading,
                    spacing: HiveSpacing.sm
                ) {
                    ForEach(visibleScripts) { script in
                        ScriptStatusToken(script: script)
                    }

                    if hiddenScriptCount > 0 {
                        DashboardMoreToken(count: hiddenScriptCount)
                    }
                }
            }
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

private struct DashboardActivityIcon: View {
    let isStreaming: Bool
    let hasUnread: Bool
    let accessibilityLabel: String

    var body: some View {
        Group {
            if isStreaming {
                AgentActivityIndicator(dotSize: 3.2, spacing: 1.6)
            } else if hasUnread {
                CompletedDot()
            } else {
                StatusDot()
            }
        }
        .frame(width: 18, height: 18)
        .accessibilityLabel(accessibilityLabel)
    }
}

private struct DashboardSectionTitle: View {
    let title: String

    var body: some View {
        Text(title.uppercased())
            .font(.caption.monospacedDigit().weight(.semibold))
            .foregroundStyle(WhisperColor.textMuted)
    }
}

private struct DashboardStatColumn: View {
    let title: String
    let value: String
    let detail: String
    let valueColor: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption2.monospacedDigit().weight(.semibold))
                .foregroundStyle(WhisperColor.textMuted)
                .lineLimit(1)

            Text(value)
                .font(WhisperFont.mono(15, weight: .semibold))
                .foregroundStyle(valueColor)
                .lineLimit(1)
                .minimumScaleFactor(0.82)

            Text(detail)
                .font(.caption2.monospacedDigit())
                .foregroundStyle(WhisperColor.textSecondary)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, HiveSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

private struct DashboardDivider: View {
    var body: some View {
        Rectangle()
            .fill(WhisperColor.separator)
            .frame(width: 0.5, height: 58)
            .padding(.vertical, 2)
    }
}

private struct DashboardEmptyLine: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.caption.monospacedDigit().weight(.medium))
            .foregroundStyle(color)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, HiveSpacing.md)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(WhisperColor.surfaceSubtle)
            )
    }
}

private struct ScriptStatusToken: View {
    let script: ScriptDashboardSummary

    var body: some View {
        HStack(spacing: 7) {
            scriptIcon

            Text(script.name)
                .foregroundStyle(WhisperColor.text)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)

            Text(script.statusText)
                .foregroundStyle(script.color)
                .lineLimit(1)
        }
        .font(.caption.monospacedDigit().weight(.medium))
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(WhisperColor.surfaceSubtle)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(script.color.opacity(script.status.state == .idle ? 0.10 : 0.22), lineWidth: 0.5)
        )
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var scriptIcon: some View {
        switch script.status.state {
        case .running:
            AgentActivityIndicator(dotSize: 2.5, spacing: 1.2)
                .frame(width: 11, height: 11)
        case .done:
            CompletedDot()
                .frame(width: 11, height: 11)
        case .error:
            Circle()
                .fill(Color.red)
                .frame(width: 7, height: 7)
                .frame(width: 11, height: 11)
        case .idle:
            StatusDot()
                .frame(width: 11, height: 11)
        }
    }
}

private struct DashboardMoreToken: View {
    let count: Int

    var body: some View {
        Text("+\(count) more")
            .font(.caption.monospacedDigit().weight(.medium))
            .foregroundStyle(WhisperColor.textMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(WhisperColor.surfaceSubtle)
            )
    }
}

private struct GitDashboardSummary {
    let isLoaded: Bool
    let fileCount: Int
    let workingCount: Int
    let branchCount: Int
    let additions: Int
    let deletions: Int

    var hasChanges: Bool {
        fileCount > 0
    }

    var filesValue: String {
        if !isLoaded { return "Syncing" }
        if hasChanges { return "\(fileCount)" }
        return "Clean"
    }

    var filesDetail: String {
        if !isLoaded { return "Fetching diff" }
        if hasChanges { return "\(workingCount) working / \(branchCount) branch" }
        return "No local diff"
    }

    var filesColor: Color {
        if !isLoaded { return WhisperColor.textMuted }
        return hasChanges ? WhisperColor.text : WhisperColor.success
    }

    var changesValue: String {
        if !isLoaded { return "..." }
        guard hasChanges else { return "0" }
        let net = additions - deletions
        if net > 0 { return "+\(net)" }
        return "\(net)"
    }

    var changesDetail: String {
        if !isLoaded { return "Waiting for stats" }
        guard hasChanges else { return "No additions or deletions" }
        return "+\(additions) / -\(deletions)"
    }

    var changesColor: Color {
        if !isLoaded { return WhisperColor.textMuted }
        return hasChanges ? WhisperColor.text : WhisperColor.success
    }

    init(stats: DiffStatResponse?) {
        guard let stats else {
            isLoaded = false
            fileCount = 0
            workingCount = 0
            branchCount = 0
            additions = 0
            deletions = 0
            return
        }

        isLoaded = true
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
    let title: String
    let detail: String
    let color: Color

    init(prStatus: PrStatusResponse?) {
        guard let prStatus else {
            title = "Loading"
            detail = "Fetching status"
            color = WhisperColor.textMuted
            return
        }
        if let error = prStatus.error, !error.isEmpty {
            title = "Unavailable"
            detail = "Provider status"
            color = WhisperColor.warningForeground
            return
        }
        guard let pr = prStatus.pr else {
            title = "No PR"
            detail = "Not opened"
            color = WhisperColor.textMuted
            return
        }

        let prefix = "#\(pr.number)"
        let checks = Self.checksText(pr)

        if pr.state == .merged {
            title = "\(prefix)"
            detail = "Merged"
            color = .purple
        } else if pr.state == .closed {
            title = "\(prefix)"
            detail = "Closed"
            color = WhisperColor.textMuted
        } else if pr.state == .draft {
            title = "\(prefix)"
            detail = "Draft"
            color = WhisperColor.textMuted
        } else if pr.mergeable == false || pr.mergeableState == .conflict {
            title = "\(prefix)"
            detail = "Conflicts"
            color = WhisperColor.warningForeground
        } else if pr.checksStatus == .failure {
            title = "\(prefix)"
            detail = "Checks failed\(checks)"
            color = .red
        } else if pr.checksStatus == .cancelled {
            title = "\(prefix)"
            detail = "Checks cancelled\(checks)"
            color = WhisperColor.warningForeground
        } else if pr.checksStatus == .pending {
            title = "\(prefix)"
            detail = "Checks\(checks)"
            color = WhisperColor.warningForeground
        } else if pr.reviewStatus == .changes_requested {
            title = "\(prefix)"
            detail = "Changes requested"
            color = WhisperColor.warningForeground
        } else if pr.mergeableState == .blocked {
            title = "\(prefix)"
            detail = "Blocked"
            color = WhisperColor.warningForeground
        } else if pr.mergeableState == .unstable {
            title = "\(prefix)"
            detail = "Unstable"
            color = WhisperColor.warningForeground
        } else if pr.reviewStatus == .review_required {
            title = "\(prefix)"
            detail = "Review needed"
            color = .blue
        } else if pr.mergeable == true || pr.mergeableState == .clean {
            title = "\(prefix)"
            detail = "Ready"
            color = WhisperColor.success
        } else {
            title = "\(prefix)"
            detail = "Open"
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
