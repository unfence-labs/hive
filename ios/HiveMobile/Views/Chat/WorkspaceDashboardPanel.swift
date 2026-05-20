import SwiftUI

private enum DashboardMetrics {
    static let gitRowMinHeight: CGFloat = 36
}

enum ScriptDashboardActionKind {
    case start
    case stop
    case restart
}

struct ScriptDashboardAction {
    let scriptId: String
    let scriptName: String
    let kind: ScriptDashboardActionKind
    let wasRunning: Bool

    var title: String {
        switch kind {
        case .start:
            return "Start \(scriptName)?"
        case .stop:
            return "Stop \(scriptName)?"
        case .restart:
            return "Restart \(scriptName)?"
        }
    }

    var message: String {
        switch kind {
        case .start:
            return "This will start the \(scriptName) script."
        case .stop:
            return "This will stop the running \(scriptName) script."
        case .restart where wasRunning:
            return "This will stop the current setup script and start it again."
        case .restart:
            return "This will run the setup script again."
        }
    }

    var confirmTitle: String {
        switch kind {
        case .start:
            return "Start"
        case .stop:
            return "Stop"
        case .restart:
            return "Restart"
        }
    }

    var isDestructive: Bool {
        kind == .stop
    }
}

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
    let onScriptAction: (ScriptDashboardAction) -> Void

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
            DashboardSectionTitle(title: "Git")

            VStack(spacing: 0) {
                GitScopeRow(title: "Branch commit", scope: gitSummary.branch)
                DashboardRowDivider()
                GitScopeRow(title: "Working tree", scope: gitSummary.workingTree)
                DashboardRowDivider()
                PullRequestRow(summary: prSummary)
            }
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
                        Button {
                            onScriptAction(script.action)
                        } label: {
                            ScriptStatusToken(script: script)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(script.action.title)
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

private struct GitScopeRow: View {
    let title: String
    let scope: GitScopeDashboardSummary

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: HiveSpacing.md) {
            Text(title)
                .font(.caption.monospacedDigit().weight(.semibold))
                .foregroundStyle(WhisperColor.textMuted)
                .lineLimit(1)
                .frame(width: 104, alignment: .leading)

            Text(scope.fileText)
                .font(.caption.monospacedDigit().weight(.medium))
                .foregroundStyle(scope.fileColor)
                .lineLimit(1)

            Spacer(minLength: HiveSpacing.sm)

            if scope.hasLineChanges {
                ChangePair(additions: scope.additions, deletions: scope.deletions)
            } else {
                Text(scope.statusText)
                    .font(.caption.monospacedDigit().weight(.medium))
                    .foregroundStyle(scope.statusColor)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, HiveSpacing.md)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, minHeight: DashboardMetrics.gitRowMinHeight, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

private struct PullRequestRow: View {
    let summary: PullRequestDashboardSummary

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: HiveSpacing.md) {
            Text("Pull Request")
                .font(.caption.monospacedDigit().weight(.semibold))
                .foregroundStyle(WhisperColor.textMuted)
                .lineLimit(1)
                .frame(width: 104, alignment: .leading)

            if let destinationURL = summary.destinationURL {
                Link(destination: destinationURL) {
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text(summary.title)
                            .font(.caption.monospacedDigit().weight(.medium))

                        Image(systemName: "arrow.up.right")
                            .font(.caption2.weight(.semibold))
                            .imageScale(.small)
                    }
                    .foregroundStyle(summary.color)
                    .lineLimit(1)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open pull request \(summary.title)")
            } else {
                Text(summary.title)
                    .font(.caption.monospacedDigit().weight(.medium))
                    .foregroundStyle(summary.color)
                    .lineLimit(1)
            }

            Spacer(minLength: HiveSpacing.sm)

            Text(summary.detail)
                .font(.caption.monospacedDigit().weight(.medium))
                .foregroundStyle(summary.color)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .padding(.horizontal, HiveSpacing.md)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, minHeight: DashboardMetrics.gitRowMinHeight, alignment: .leading)
        .accessibilityElement(children: summary.destinationURL == nil ? .combine : .contain)
    }
}

private struct ChangePair: View {
    let additions: Int
    let deletions: Int

    var body: some View {
        HStack(spacing: HiveSpacing.sm) {
            if additions > 0 {
                Text("+\(additions)")
                    .foregroundStyle(WhisperColor.success)
            }
            if deletions > 0 {
                Text("-\(deletions)")
                    .foregroundStyle(.red)
            }
        }
        .font(.caption.monospacedDigit().weight(.medium))
        .lineLimit(1)
    }
}

private struct DashboardRowDivider: View {
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        Rectangle()
            .fill(WhisperColor.separator)
            .frame(height: 1 / displayScale)
            .padding(.horizontal, HiveSpacing.md)
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
            ScriptStatusDot(summary: script)

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
}

private struct ScriptStatusDot: View {
    let summary: ScriptDashboardSummary

    var body: some View {
        Circle()
            .fill(summary.color)
            .frame(width: diameter, height: diameter)
            .frame(width: 11, height: 11)
    }

    private var diameter: CGFloat {
        switch summary.status.state {
        case .running, .done, .error:
            return 7
        case .idle:
            return 6
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
    let branch: GitScopeDashboardSummary
    let workingTree: GitScopeDashboardSummary

    init(stats: DiffStatResponse?) {
        guard let stats else {
            branch = GitScopeDashboardSummary.loading()
            workingTree = GitScopeDashboardSummary.loading()
            return
        }

        branch = GitScopeDashboardSummary(files: stats.committed, cleanText: "no branch diff")
        workingTree = GitScopeDashboardSummary(files: stats.uncommitted, cleanText: "clean")
    }
}

private struct GitScopeDashboardSummary {
    let isLoaded: Bool
    let fileCount: Int
    let additions: Int
    let deletions: Int
    let cleanText: String

    var hasChanges: Bool {
        isLoaded && fileCount > 0
    }

    var hasLineChanges: Bool {
        hasChanges && (additions > 0 || deletions > 0)
    }

    var fileText: String {
        if !isLoaded { return "syncing" }
        if !hasChanges { return "-" }
        return "\(fileCount) file\(fileCount == 1 ? "" : "s")"
    }

    var fileColor: Color {
        hasChanges ? WhisperColor.text : WhisperColor.textMuted
    }

    var statusText: String {
        if hasChanges { return "changed" }
        return isLoaded ? "-" : "waiting"
    }

    var statusColor: Color {
        WhisperColor.textMuted
    }

    init(files: [DiffFileStat], cleanText: String) {
        isLoaded = true
        fileCount = Set(files.map(\.file)).count
        additions = files.reduce(0) { $0 + $1.additions }
        deletions = files.reduce(0) { $0 + $1.deletions }
        self.cleanText = cleanText
    }

    private init(isLoaded: Bool, fileCount: Int, additions: Int, deletions: Int, cleanText: String) {
        self.isLoaded = isLoaded
        self.fileCount = fileCount
        self.additions = additions
        self.deletions = deletions
        self.cleanText = cleanText
    }

    static func loading() -> GitScopeDashboardSummary {
        GitScopeDashboardSummary(
            isLoaded: false,
            fileCount: 0,
            additions: 0,
            deletions: 0,
            cleanText: "waiting"
        )
    }
}

private struct ScriptDashboardSummary: Identifiable {
    let id: String
    let name: String
    let isSetup: Bool
    let status: ScriptStatusInfo

    var action: ScriptDashboardAction {
        ScriptDashboardAction(
            scriptId: id,
            scriptName: name,
            kind: actionKind,
            wasRunning: status.state == .running
        )
    }

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
            return "-"
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

    private var actionKind: ScriptDashboardActionKind {
        if isSetup {
            return .restart
        }
        return status.state == .running ? .stop : .start
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
                isSetup: id == "setup",
                status: mergedStatus[id] ?? ScriptStatusInfo(state: .idle)
            )
        }
    }
}

private struct PullRequestDashboardSummary {
    let title: String
    let detail: String
    let color: Color
    let destinationURL: URL?

    init(prStatus: PrStatusResponse?) {
        guard let prStatus else {
            title = "Loading"
            detail = "Fetching status"
            color = WhisperColor.textMuted
            destinationURL = nil
            return
        }
        if let error = prStatus.error, !error.isEmpty {
            title = "Fetch error"
            detail = "-"
            color = .red
            destinationURL = nil
            return
        }
        guard let pr = prStatus.pr else {
            title = "No PR"
            detail = "-"
            color = WhisperColor.textMuted
            destinationURL = nil
            return
        }

        let prefix = "#\(pr.number)"
        let checks = Self.checksText(pr)
        destinationURL = Self.destinationURL(from: pr.url)

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

    private static func destinationURL(from rawURL: String) -> URL? {
        guard
            let url = URL(string: rawURL),
            let scheme = url.scheme?.lowercased(),
            scheme == "https" || scheme == "http"
        else {
            return nil
        }
        return url
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
        scriptsLoadFailed: false,
        onScriptAction: { _ in }
    )
    .frame(height: 260)
    .hiveScreenBackground()
    .preferredColorScheme(.dark)
}
