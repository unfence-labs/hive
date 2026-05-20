import SwiftUI

struct HubDiffSummary {
    let additions: Int
    let deletions: Int

    init(diffStats: DiffStatResponse?) {
        guard let diffStats else {
            additions = 0
            deletions = 0
            return
        }

        let files = diffStats.committed + diffStats.uncommitted
        additions = files.reduce(0) { $0 + $1.additions }
        deletions = files.reduce(0) { $0 + $1.deletions }
    }

    var hasChanges: Bool {
        additions > 0 || deletions > 0
    }
}

enum HubPrStatusRules {
    static func needsAttention(_ pr: PullRequestInfo) -> Bool {
        pr.mergeable == false
            || pr.mergeableState == .conflict
            || pr.mergeableState == .blocked
            || pr.checksStatus == .failure
            || pr.reviewStatus == .changes_requested
    }
}

struct HubPrStatusDisplay {
    let icon: String
    let label: String
    let dashboardDetail: String
    let color: Color

    init(pr: PullRequestInfo) {
        let checksCount = Self.checksCountLabel(pr)

        if pr.state == .merged {
            self.init(icon: "arrow.triangle.merge", label: "Merged", dashboardDetail: "Merged", color: .purple)
        } else if pr.state == .closed {
            self.init(icon: "xmark.circle", label: "Closed", dashboardDetail: "Closed", color: WhisperColor.textMuted)
        } else if pr.state == .draft {
            self.init(icon: "pencil.circle", label: "Draft", dashboardDetail: "Draft", color: WhisperColor.textMuted)
        } else if pr.mergeable == false || pr.mergeableState == .conflict {
            self.init(icon: "exclamationmark.triangle", label: "Conflicts", dashboardDetail: "Conflicts", color: WhisperColor.warningForeground)
        } else if pr.checksStatus == .failure {
            self.init(icon: "xmark.circle", label: "Failed\(checksCount)", dashboardDetail: "Checks failed\(checksCount)", color: .red)
        } else if pr.checksStatus == .cancelled {
            self.init(icon: "nosign", label: "Cancelled", dashboardDetail: "Checks cancelled\(checksCount)", color: WhisperColor.warningForeground)
        } else if pr.checksStatus == .pending {
            self.init(icon: "clock", label: "Checks\(checksCount)", dashboardDetail: "Checks\(checksCount)", color: WhisperColor.warningForeground)
        } else if pr.reviewStatus == .changes_requested {
            self.init(icon: "exclamationmark.triangle", label: "Changes", dashboardDetail: "Changes requested", color: WhisperColor.warningForeground)
        } else if pr.mergeableState == .blocked {
            self.init(icon: "nosign", label: "Blocked", dashboardDetail: "Blocked", color: WhisperColor.warningForeground)
        } else if pr.mergeableState == .unstable {
            self.init(icon: "exclamationmark.triangle", label: "Unstable", dashboardDetail: "Unstable", color: WhisperColor.warningForeground)
        } else if pr.reviewStatus == .review_required {
            self.init(icon: "eye", label: "Review", dashboardDetail: "Review needed", color: .blue)
        } else if pr.mergeable == true || pr.mergeableState == .clean {
            self.init(icon: "checkmark.circle", label: "Ready", dashboardDetail: "Ready", color: WhisperColor.success)
        } else {
            self.init(icon: "arrow.triangle.pull", label: "Open", dashboardDetail: "Open", color: .blue)
        }
    }

    private init(icon: String, label: String, dashboardDetail: String, color: Color) {
        self.icon = icon
        self.label = label
        self.dashboardDetail = dashboardDetail
        self.color = color
    }

    private static func checksCountLabel(_ pr: PullRequestInfo) -> String {
        guard let passed = pr.checksPassed, let total = pr.checksTotal else { return "" }
        return " \(passed)/\(total)"
    }
}
