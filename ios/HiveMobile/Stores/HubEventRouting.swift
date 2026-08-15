import Foundation

@MainActor
protocol HubEventSink: AnyObject {
    func didReceiveActivity(_ event: WsOutgoing, for workspaceId: String)
    func didReceiveStreaming(_ streaming: Bool, for workspaceId: String, sessionId: String?)
    func ensureStoreExists(for workspaceId: String)
    func didReceiveUnreadState(_ sessions: [UnreadSessionState], for workspaceId: String)
    func didReceiveDiffStats(_ stats: DiffStatResponse, for workspaceId: String)
    func didReceivePrStatus(_ status: PrStatusResponse, for workspaceId: String)
    func didReceiveBranchInfo(_ info: BranchInfo, for workspaceId: String)
    func didReceiveScriptStatus(scriptType: String, state: String, exitCode: Int?, for workspaceId: String)
    func forward(_ event: WsOutgoing, for workspaceId: String)
}

enum HubEventRouter {
    @MainActor
    static func route(_ envelope: HubOutgoing, to sink: HubEventSink) {
        guard case .workspaceEvent(let workspaceId, let event) = envelope else { return }
        sink.didReceiveActivity(event, for: workspaceId)

        switch event {
        case .status(_, let sessionId, let streaming, _, _):
            let isStreaming = streaming ?? false
            sink.didReceiveStreaming(isStreaming, for: workspaceId, sessionId: sessionId)
            if isStreaming {
                sink.ensureStoreExists(for: workspaceId)
            }
        case .diffStats(let stats):
            sink.didReceiveDiffStats(stats, for: workspaceId)

        case .prStatus(let status):
            sink.didReceivePrStatus(status, for: workspaceId)

        case .branchInfo(let info):
            sink.didReceiveBranchInfo(info, for: workspaceId)

        case .scriptStatus(let scriptType, let state, let exitCode):
            sink.didReceiveScriptStatus(scriptType: scriptType, state: state, exitCode: exitCode, for: workspaceId)

        case .done(let sessionId, _, _, _, _, _, _):
            sink.didReceiveStreaming(false, for: workspaceId, sessionId: sessionId)

        case .cancelled(let sessionId, _, _, _):
            sink.didReceiveStreaming(false, for: workspaceId, sessionId: sessionId)

        case .unreadState(let sessions):
            sink.didReceiveUnreadState(sessions, for: workspaceId)

        case .streamSnapshot(let sessionId, _, _, _, _, _, _):
            sink.didReceiveStreaming(true, for: workspaceId, sessionId: sessionId)
            sink.ensureStoreExists(for: workspaceId)

        default:
            break
        }

        sink.forward(event, for: workspaceId)
    }
}
