import Foundation

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
