import Foundation

/// Synthetic workspace id used to address the Brain over the shared hub WS and
/// the workspace-scoped session REST routes (`/api/workspaces/brain/...`).
/// Mirrors `BRAIN_WORKSPACE_ID` on web/backend.
let BRAIN_WORKSPACE_ID = "brain"

// MARK: - Brain state

/// Result of `GET /api/brain`. The backend sends either `{ exists: false }`
/// or `{ exists: true, repoUrl, createdAt, lastSyncedAt }`.
struct BrainState: Decodable {
    let exists: Bool
    let repoUrl: String?
    let createdAt: String?
    let lastSyncedAt: String?
}

// MARK: - Brain working-tree status

enum BrainFileStatusKind: String, Decodable {
    case added
    case modified
    case deleted
    case renamed
    case untracked
}

struct BrainFileStatus: Decodable, Identifiable {
    let path: String
    let status: BrainFileStatusKind
    let renamedFrom: String?

    var id: String { path }
}

/// Result of `GET /api/brain/status` — pending working-tree changes plus sync
/// metadata for the Brain clone.
struct BrainStatusResponse: Decodable {
    let files: [BrainFileStatus]
    let count: Int
    let upstream: String?
    let lastSyncedAt: String?
    let unpushedCommitCount: Int?
}

// MARK: - Brain save

/// Result of `POST /api/brain/save`. `committed == false` means nothing to
/// commit (not an error); `committed && !pushed` means the local commit was
/// kept but the push failed (`error` carries the reason).
struct BrainSaveResponse: Decodable {
    let committed: Bool
    let pushed: Bool
    let lastSyncedAt: String?
    let error: String?
}

// MARK: - Save indicator + derived sync state (pure, testable)

/// Transient indicator driven by the user's Save action, mirroring the web
/// `BrainSaveIndicator`.
enum BrainSaveIndicator {
    case idle
    case saving
    case saved
    case pushFailed
}

/// Combined sync state shown in the Brain Save panel, mirroring the web
/// `deriveBrainSyncState` precedence in `BrainView.tsx`.
enum BrainSyncState {
    case loading
    case error
    case saving
    case pushFailed
    case saved
    case pending
    case unpushed
    case synced

    var label: String {
        switch self {
        case .loading: return "Loading…"
        case .error: return "Status unavailable"
        case .saving: return "Saving…"
        case .pushFailed: return "Push failed"
        case .saved: return "Saved"
        case .pending: return "Unsaved changes"
        case .unpushed: return "Not pushed"
        case .synced: return "Up to date"
        }
    }
}

/// Pure derivation of the Brain sync state from the live inputs. Kept free of
/// SwiftUI so it can be unit-tested. Color mapping lives in the view layer.
func brainSyncState(
    statusLoading: Bool,
    statusError: Bool,
    saveIndicator: BrainSaveIndicator,
    pendingCount: Int,
    unpushedCommitCount: Int?
) -> BrainSyncState {
    if saveIndicator == .saving { return .saving }
    if saveIndicator == .pushFailed { return .pushFailed }
    if statusError { return .error }
    if statusLoading { return .loading }
    if saveIndicator == .saved { return .saved }
    if pendingCount > 0 { return .pending }
    if (unpushedCommitCount ?? 0) > 0 { return .unpushed }
    return .synced
}
