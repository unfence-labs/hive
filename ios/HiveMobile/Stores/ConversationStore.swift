import Foundation
import Observation

// MARK: - Per-session streaming state

@Observable
final class SessionStreamState {
    var currentText = ""
    var currentThinking = ""
    var activeToolCalls: [ToolCall] = []
    var activeAgentActivities: [AgentActivity] = []
    var isStreaming = false
    var streamingStartedAt: Date?
    var pendingToolInputs: [PendingToolInput] = []
    var agentPlanMode: Bool?
    var failedSend: FailedSend?
}

@MainActor
@Observable
final class ConversationStore {
    private static let outgoingTimestampFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    /// ISO8601 timestamp for the current moment (shared formatter).
    static func timestamp() -> String {
        outgoingTimestampFormatter.string(from: Date())
    }

    // MARK: - Public state

    /// Send closure wired by HubStatusMonitor to the workspace's WS connection.
    /// Returns `true` if the message was handed to the WebSocket, `false` otherwise.
    var send: ((WsIncoming) async -> Bool)?

    var messages: [ChatMessage] = [] {
        didSet { recomputeDerivations() }
    }

    /// Per-session finalized-history cache. Mirrors web's React Query cache so
    /// switching back to a previously-viewed session restores its messages
    /// instantly (no empty flash) while the authoritative REST refetch runs.
    private var messagesBySession: [String: [ChatMessage]] = [:]
    private var serverHistory: [String: [ChatMessage]] = [:]
    private var cacheOrder: [String] = []
    private let maxCachedSessions = 6
    private var lastHistoryFetchAt: [String: Date] = [:]

    /// Session currently displayed in chat.
    var sessionId: String?

    /// Monotonically increasing tokens keyed by session ID.
    /// Used to discard stale REST history fetches on a per-session basis.
    private var historyTokenBySession: [String: Int] = [:]

    /// Called when a turn finishes (done/cancelled) with the session ID.
    /// ChatView wires this to re-fetch messages from REST so client-generated
    /// UUIDs are replaced with backend-assigned IDs.
    var onTurnCompleted: ((String) -> Void)?

    /// Per-session transient streaming state. Keyed by session ID.
    var sessionStreams: [String: SessionStreamState] = [:]

    /// True while a ChatView for the focused session is the visible foreground
    /// screen. Gates the turn-completion haptic to on-screen completions only;
    /// set by ChatView on appear/disappear.
    @ObservationIgnored var isChatVisible = false

    /// Bumps once per agent turn that completes while its chat is the visible
    /// screen. Background sessions, other tabs, and non-visible screens never
    /// bump it. ChatView observes this to fire the success haptic.
    private(set) var visibleCompletionCount = 0

    // Branch & diff info (pushed via WS)
    var branchInfo: BranchInfo?
    var diffStats: DiffStatResponse?

    /// Provider locked for this session (pushed via WS status events).
    var lockedProvider: String?

    private let streamFlushInterval: TimeInterval?
    @ObservationIgnored private var pendingTextBySession: [String: String] = [:]
    @ObservationIgnored private var pendingThinkingBySession: [String: String] = [:]
    @ObservationIgnored private var flushTask: Task<Void, Never>?

    /// `nil` disables the scheduled auto-flush (tests flush manually).
    init(streamFlushInterval: TimeInterval? = 0.05) {
        self.streamFlushInterval = streamFlushInterval
    }

    // MARK: - Computed

    /// The active session's stream state (convenience accessor).
    var activeStream: SessionStreamState? {
        sessionId.flatMap { sessionStreams[$0] }
    }

    /// Whether the active session's agent entered plan mode on its own (via EnterPlanMode).
    var agentPlanMode: Bool? { activeStream?.agentPlanMode }

    /// Busy state for the currently focused session only.
    var isBusy: Bool { activeStream?.isStreaming ?? false }
    var isStreaming: Bool { activeStream?.isStreaming ?? false }
    var streamingStartedAt: Date? { activeStream?.streamingStartedAt }
    var currentText: String { activeStream?.currentText ?? "" }
    var currentThinking: String { activeStream?.currentThinking ?? "" }
    var activeToolCalls: [ToolCall] { activeStream?.activeToolCalls ?? [] }
    var activeAgentActivities: [AgentActivity] { activeStream?.activeAgentActivities ?? [] }
    var pendingToolInputs: [PendingToolInput] { activeStream?.pendingToolInputs ?? [] }

    /// Store-owned failed send for the focused session, if any.
    var failedSend: FailedSend? { activeStream?.failedSend }

    private(set) var tasksState: TasksState =
        deriveTasks(from: [], activeToolCalls: [], activeAgentActivities: [])
    private(set) var goalState: GoalState? =
        deriveGoalState(from: [], activeAgentActivities: [])
    private(set) var backgroundAgents: BackgroundAgentsState =
        deriveBackgroundAgents(from: [], activeToolCalls: [])
    private(set) var dismissedToolCallIds: Set<String> = []
    @ObservationIgnored private(set) var derivationRunCount = 0

    private func recomputeDerivations() {
        derivationRunCount += 1
        let toolCalls = activeStream?.activeToolCalls ?? []
        let activities = activeStream?.activeAgentActivities ?? []
        tasksState = deriveTasks(
            from: messages,
            activeToolCalls: toolCalls,
            activeAgentActivities: activities
        )
        goalState = deriveGoalState(from: messages, activeAgentActivities: activities)
        backgroundAgents = deriveBackgroundAgents(from: messages, activeToolCalls: toolCalls)
        dismissedToolCallIds = deriveDismissedToolCallIds(from: messages)
    }

    // MARK: - Streaming delta buffering

    func flushStreamingDeltas() {
        flushTask?.cancel()
        flushTask = nil
        guard !pendingTextBySession.isEmpty || !pendingThinkingBySession.isEmpty else { return }
        for (sid, text) in pendingTextBySession {
            sessionStreams[sid]?.currentText += text
        }
        for (sid, text) in pendingThinkingBySession {
            sessionStreams[sid]?.currentThinking += text
        }
        pendingTextBySession = [:]
        pendingThinkingBySession = [:]
    }

    private func scheduleStreamFlush() {
        guard let interval = streamFlushInterval, flushTask == nil else { return }
        flushTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(interval))
            guard !Task.isCancelled else { return }
            self?.flushStreamingDeltas()
        }
    }

    // MARK: - Event handling

    func handle(_ event: WsOutgoing) {
        switch event {
        case .textDelta(let sid, let text):
            guard sessionStreams[sid] != nil else { return }
            pendingTextBySession[sid, default: ""] += text
            scheduleStreamFlush()

        case .thinking(let sid, let text):
            guard sessionStreams[sid] != nil else { return }
            pendingThinkingBySession[sid, default: ""] += text
            scheduleStreamFlush()

        case .toolUse(let sid, let id, let name, let input, let parentToolUseId):
            guard sessionStreams[sid] != nil else { return }
            sessionStreams[sid]?.activeToolCalls.append(ToolCall(
                id: id, name: name, input: input,
                output: nil, parentToolUseId: parentToolUseId
            ))
            if sid == sessionId {
                recomputeDerivations()
            }

        case .toolResult(let sid, let toolUseId, let output):
            guard let stream = sessionStreams[sid],
                  let idx = stream.activeToolCalls.firstIndex(where: { $0.id == toolUseId }) else { return }
            let tc = stream.activeToolCalls[idx]
            sessionStreams[sid]?.activeToolCalls[idx] = ToolCall(
                id: tc.id, name: tc.name, input: tc.input,
                output: output, parentToolUseId: tc.parentToolUseId
            )
            if sid == sessionId {
                recomputeDerivations()
            }

        case .agentActivity(let sid, let activity):
            upsertAgentActivity(activity, for: sid)

        case .streamSnapshot(let sid, let text, let thinking, let toolCalls,
                             let agentActivities, let agentPlanMode, let startedAt):
            pendingTextBySession.removeValue(forKey: sid)
            pendingThinkingBySession.removeValue(forKey: sid)
            let stream = sessionStreams[sid] ?? SessionStreamState()
            stream.currentText = text
            stream.currentThinking = thinking
            stream.activeToolCalls = toolCalls
            stream.activeAgentActivities = agentActivities
            stream.isStreaming = true
            stream.streamingStartedAt = startedAt.map(parseStartedAt) ?? stream.streamingStartedAt ?? Date()
            stream.pendingToolInputs = []
            stream.agentPlanMode = agentPlanMode
            sessionStreams[sid] = stream
            if sessionId == nil {
                sessionId = sid
            }
            if sid == sessionId {
                recomputeDerivations()
            }

        case .toolInputRequired(let sid, let requestId, let toolName, let toolUseId, let input):
            flushStreamingDeltas()
            if sessionStreams[sid] == nil && hasTerminalAssistantMessage(for: sid) {
                return
            }
            ensureStream(for: sid, streaming: false)
            // Idempotent by requestId so a snapshot/replay on reconnect can never
            // produce a duplicate pending question.
            if sessionStreams[sid]?.pendingToolInputs.contains(where: { $0.requestId == requestId }) != true {
                sessionStreams[sid]?.pendingToolInputs.append(PendingToolInput(
                    sessionId: sid, requestId: requestId,
                    toolName: toolName, toolUseId: toolUseId, input: input
                ))
            }

        case .toolInputResolved(let sid):
            // A client (possibly another device) answered or dismissed the question.
            sessionStreams[sid]?.pendingToolInputs = []

        case .done(let sid, let durationMs, let inputTokens, let outputTokens,
                   let contextUsedTokens, let contextWindowTokens, _):
            flushStreamingDeltas()
            finalizeMessage(sessionId: sid, durationMs: durationMs, cancelled: false,
                            inputTokens: inputTokens, outputTokens: outputTokens,
                            contextUsedTokens: contextUsedTokens,
                            contextWindowTokens: contextWindowTokens)
            lastHistoryFetchAt.removeValue(forKey: sid)
            bumpHistoryToken(for: sid)
            onTurnCompleted?(sid)
            registerVisibleCompletion(for: sid)

        case .cancelled(let sid, let errorDetail, _, let durationMs):
            flushStreamingDeltas()
            finalizeMessage(sessionId: sid, durationMs: durationMs, cancelled: true, errorDetail: errorDetail)
            lastHistoryFetchAt.removeValue(forKey: sid)
            bumpHistoryToken(for: sid)
            onTurnCompleted?(sid)

        case .error(let message, let errorSessionId):
            flushStreamingDeltas()
            if let errorSessionId, let currentSessionId = sessionId, errorSessionId != currentSessionId {
                return
            }
            messages.append(ChatMessage(
                id: UUID().uuidString, sessionId: "", role: .assistant,
                content: "Error: \(message)", images: nil, toolCalls: nil,
                agentActivities: nil,
                thinkingContent: nil, timestamp: Self.outgoingTimestampFormatter.string(from: Date()),
                cancelled: nil, durationMs: nil
            ))

        case .status(let status, let incomingSessionId, let streaming, let startedAt, let provider):
            flushStreamingDeltas()
            let newIsStreaming = streaming ?? (status == .idle ? false : nil)

            if let sid = incomingSessionId, let newIsStreaming {
                if newIsStreaming {
                    ensureStream(for: sid)
                    if let stream = sessionStreams[sid] {
                        stream.isStreaming = true
                        // A (re)starting turn means any pending question was
                        // answered, possibly on another client (e.g. web).
                        stream.pendingToolInputs = []
                        // Prefer backend start time so iOS/web timers stay aligned.
                        if let startedAt {
                            stream.streamingStartedAt = parseStartedAt(startedAt)
                        } else if stream.streamingStartedAt == nil {
                            stream.streamingStartedAt = Date()
                        }
                        sessionStreams[sid] = stream
                    }
                } else if let stream = sessionStreams[sid] {
                    let wasStreaming = stream.isStreaming
                    // Session stopped streaming. Clean up if no content.
                    if stream.currentText.isEmpty && stream.currentThinking.isEmpty
                        && stream.activeToolCalls.isEmpty && stream.activeAgentActivities.isEmpty
                        && stream.pendingToolInputs.isEmpty {
                        sessionStreams.removeValue(forKey: sid)
                    } else {
                        stream.isStreaming = false
                        stream.streamingStartedAt = nil
                        sessionStreams[sid] = stream
                    }
                    // Turn ended without a `done` (e.g. finished while backgrounded):
                    // reconcile the finalized message from REST like `done` does.
                    if wasStreaming {
                        lastHistoryFetchAt.removeValue(forKey: sid)
                        bumpHistoryToken(for: sid)
                        onTurnCompleted?(sid)
                    }
                }
            }

            // Only update lockedProvider for the active session
            if let provider, incomingSessionId == sessionId {
                lockedProvider = provider
            }

            // Only adopt sessionId from status if we don't have one yet
            if sessionId == nil, let incomingSessionId {
                sessionId = incomingSessionId
            }
            if let incomingSessionId, incomingSessionId == sessionId {
                recomputeDerivations()
            }

        case .userMessage(let msg):
            let sid = msg.sessionId
            let isActive = sessionId == nil || sid == sessionId
            let alreadyExists = messages.contains { $0.id == msg.id }
            sessionId = sessionId ?? sid
            ensureStream(for: sid)
            pendingTextBySession.removeValue(forKey: sid)
            pendingThinkingBySession.removeValue(forKey: sid)
            sessionStreams[sid]?.currentText = ""
            sessionStreams[sid]?.currentThinking = ""
            sessionStreams[sid]?.activeToolCalls = []
            sessionStreams[sid]?.activeAgentActivities = []
            sessionStreams[sid]?.pendingToolInputs = []
            if isActive && !alreadyExists {
                messages.append(msg)
                cacheMessages(messages, for: sid)
            } else if isActive {
                recomputeDerivations()
            } else {
                lastHistoryFetchAt.removeValue(forKey: sid)
            }

        case .history(let msgs, let incomingSessionId):
            // Conversation history is REST-owned unconditionally, so the backend
            // no longer sends a `history` bootstrap event. This case remains only
            // as a defensive fallback (e.g. an older backend) and routes through
            // the same path the REST fetch uses, so reconciliation logic lives in
            // one place.
            let historySessionId = incomingSessionId ?? msgs.first?.sessionId ?? sessionId
            guard let sid = historySessionId else { return }
            // Adopt the session when none is focused yet so the messages land on
            // the active conversation (matches the pre-REST history behaviour).
            if sessionId == nil {
                sessionId = sid
            }
            bumpHistoryToken(for: sid)
            applyFetchedHistory(msgs, for: sid)

        case .branchInfo(let info):
            branchInfo = info

        case .diffStats(let stats):
            diffStats = stats

        case .scriptStatus, .prStatus:
            break // Handled by sidebar, not relevant to chat

        case .planModeChanged(let sid, let active):
            guard sessionStreams[sid] != nil else { return }
            sessionStreams[sid]?.agentPlanMode = active

        case .unknown:
            break
        }
    }

    /// Cached finalized messages for a session, if any have been fetched before.
    /// Used by ChatView to render instantly on switch-back while the authoritative
    /// REST refetch runs in the background.
    func cachedMessages(for sessionId: String) -> [ChatMessage]? {
        messagesBySession[sessionId]
    }

    /// Apply finalized history fetched from REST (or, defensively, a WS `history`
    /// event) for a session. Caches it for instant switch-back, and — if the
    /// session is currently active — applies it to `messages` and reconciles any
    /// stale in-progress stream slot.
    ///
    /// History contains only finalized turns. Streaming content lives in
    /// `sessionStreams` and is rendered as a separate in-progress bubble.
    func applyFetchedHistory(_ msgs: [ChatMessage], for sessionId: String) {
        serverHistory[sessionId] = msgs
        cacheMessages(msgs, for: sessionId)
        lastHistoryFetchAt[sessionId] = Date()

        guard sessionId == self.sessionId else { return }

        // Reconcile any stale in-progress stream slot for a non-streaming session.
        // History only carries finalized turns, so when it arrives for a session
        // that is NOT actively streaming, any leftover stream slot has already been
        // persisted into `messages` (e.g. the turn finished while the socket was a
        // backgrounded zombie). Rebuild a CLEAN slot containing only pending tool
        // inputs (an unanswered question/plan), or drop the stale slot entirely.
        // During streaming, live WS state takes precedence, so we leave it untouched.
        // Runs before the `messages` assignment so its `didSet` derivation pass
        // sees the reconciled stream state (one recompute, not two).
        let existingStream = sessionStreams[sessionId]
        if existingStream?.isStreaming != true {
            // A store-owned failed send is not part of REST history; carry it
            // across the reconciliation so a refetch never erases the error row.
            let preservedFailedSend = existingStream?.failedSend
            let derived = derivePendingToolInputsFromHistory(msgs)
            if !derived.isEmpty {
                let rebuilt = SessionStreamState()
                rebuilt.pendingToolInputs = derived
                rebuilt.failedSend = preservedFailedSend
                sessionStreams[sessionId] = rebuilt
            } else if preservedFailedSend != nil {
                let rebuilt = SessionStreamState()
                rebuilt.failedSend = preservedFailedSend
                sessionStreams[sessionId] = rebuilt
            } else if existingStream != nil {
                sessionStreams.removeValue(forKey: sessionId)
            }
        }

        messages = msgs
    }

    func lastServerMessageId(for sessionId: String?) -> String? {
        guard let sessionId else { return nil }
        return serverHistory[sessionId]?.last?.id
    }

    func applyIncrementalHistory(_ tail: [ChatMessage], for sessionId: String) {
        let base = serverHistory[sessionId] ?? []
        let baseIds = Set(base.map(\.id))
        // The backend returns the FULL list when the since-id is unknown; a
        // genuine tail never shares ids with the base, so overlap means replace.
        if base.isEmpty || tail.contains(where: { baseIds.contains($0.id) }) {
            applyFetchedHistory(tail, for: sessionId)
            return
        }
        applyFetchedHistory(base + tail, for: sessionId)
    }

    func clearPendingToolInputs() {
        guard let sid = sessionId else { return }
        sessionStreams[sid]?.pendingToolInputs = []
    }

    // MARK: - Failed sends

    /// Record a send that failed to reach the WebSocket as a store-owned error
    /// state. Replaces any prior failed send for the same session.
    func recordFailedSend(_ failed: FailedSend) {
        ensureStream(for: failed.sessionId, streaming: false)
        sessionStreams[failed.sessionId]?.failedSend = failed
    }

    /// Dismiss a failed send without retrying.
    func discardFailedSend(for sessionId: String) {
        sessionStreams[sessionId]?.failedSend = nil
    }

    /// Retry a failed send. A message replays through the normal send path and
    /// clears on success (kept, with reason refreshed, on failure). A tool-input
    /// answer re-presents its pending question instead of blind-resending.
    /// Returns `true` when the failed-send state was resolved.
    @discardableResult
    func retryFailedSend(for sessionId: String) async -> Bool {
        guard let failed = sessionStreams[sessionId]?.failedSend else { return false }
        switch failed.retry {
        case let .message(content, images, options):
            let sent = await send?(.userMessage(
                content: content, images: images, fileMentions: nil,
                options: options, sessionId: sessionId
            )) ?? false
            if sent {
                sessionStreams[sessionId]?.failedSend = nil
                bumpHistoryToken(for: sessionId)
            }
            return sent
        case let .toolInput(pending):
            sessionStreams[sessionId]?.failedSend = nil
            ensureStream(for: sessionId, streaming: false)
            if let stream = sessionStreams[sessionId],
               !stream.pendingToolInputs.contains(where: { $0.requestId == pending.requestId }) {
                stream.pendingToolInputs.append(pending)
            }
            return true
        }
    }

    /// Set plan-mode state for a specific session.
    func setAgentPlanMode(_ active: Bool?, for sessionId: String?) {
        guard let sessionId else { return }
        ensureStream(for: sessionId, streaming: false)
        sessionStreams[sessionId]?.agentPlanMode = active
    }

    /// Current history token for a given session.
    func historyToken(for sessionId: String?) -> Int {
        guard let sessionId else { return 0 }
        return historyTokenBySession[sessionId] ?? 0
    }

    /// Begin a new REST history request for a session.
    /// Returns the request token that must still match when applying results.
    @discardableResult
    func beginHistoryRequest(for sessionId: String?) -> Int {
        guard let sessionId else { return 0 }
        let next = (historyTokenBySession[sessionId] ?? 0) + 1
        historyTokenBySession[sessionId] = next
        return next
    }

    /// Invalidate in-flight REST history requests for a session.
    func bumpHistoryToken(for sessionId: String?) {
        _ = beginHistoryRequest(for: sessionId)
    }

    func setFocusedSessionId(_ value: String?) {
        sessionId = value
        recomputeDerivations()
    }

    func prepareSessionSwitch(_ newSessionId: String) {
        let previousSessionId = sessionId
        sessionId = newSessionId
        // Restore from the per-session cache for instant switch-back (no empty
        // flash). The REST refetch in ChatView replaces this with the
        // authoritative copy. Empty array when this session was never viewed.
        messages = messagesBySession[newSessionId] ?? []
        lockedProvider = nil
        bumpHistoryToken(for: previousSessionId)
        bumpHistoryToken(for: newSessionId)
        // sessionStreams is untouched — background sessions keep accumulating
    }

    func removeSessionState(_ removedSessionId: String, fallbackSessionId: String?) {
        sessionStreams.removeValue(forKey: removedSessionId)
        historyTokenBySession.removeValue(forKey: removedSessionId)
        messagesBySession.removeValue(forKey: removedSessionId)
        serverHistory.removeValue(forKey: removedSessionId)
        lastHistoryFetchAt.removeValue(forKey: removedSessionId)
        cacheOrder.removeAll { $0 == removedSessionId }

        guard sessionId == removedSessionId else { return }

        // Restore the fallback's cached messages (if any) for instant display.
        if let fallbackSessionId, fallbackSessionId != removedSessionId {
            sessionId = fallbackSessionId
            messages = messagesBySession[fallbackSessionId] ?? []
            lockedProvider = nil
            bumpHistoryToken(for: fallbackSessionId)
        } else {
            sessionId = nil
            messages = []
            lockedProvider = nil
        }
    }

    /// Delete one session via the injected `delete` call (REST in the app, a
    /// stub in tests) and reconcile store state. Returns whether the delete
    /// succeeded and an error message naming the conversation when it fails.
    func deleteSession(
        _ target: SessionMetadata,
        from sessions: [SessionMetadata],
        focusedSessionId: String?,
        delete: (String) async throws -> Void
    ) async -> (deleted: Bool, errorMessage: String?) {
        do {
            try await delete(target.sessionId)
        } catch is CancellationError {
            return (false, nil)
        } catch {
            return (false, "Failed to delete \"\(target.displayTitle)\": \(error.localizedDescription)")
        }

        if let focusedSessionId, focusedSessionId == target.sessionId {
            let fallbackSessionId = sessions.first { $0.sessionId != target.sessionId }?.sessionId
            if sessionId == nil {
                setFocusedSessionId(focusedSessionId)
            }
            removeSessionState(focusedSessionId, fallbackSessionId: fallbackSessionId)
            if let fallbackSessionId {
                _ = await send?(.switchSession(sessionId: fallbackSessionId))
            }
        } else {
            removeSessionState(target.sessionId, fallbackSessionId: nil)
        }

        return (true, nil)
    }

    // MARK: - Private

    /// A turn finished for `sid`. Only bump the observable completion counter
    /// when that session's chat is the visible screen, so haptics never fire for
    /// background sessions, other tabs, or non-visible screens.
    private func registerVisibleCompletion(for sid: String) {
        guard isChatVisible, sid == sessionId else { return }
        visibleCompletionCount += 1
    }

    /// Ensure a stream slot exists for the given session, defaulting to streaming state.
    private func ensureStream(for sid: String, streaming: Bool = true) {
        if sessionStreams[sid] == nil {
            let stream = SessionStreamState()
            stream.isStreaming = streaming
            if streaming {
                stream.streamingStartedAt = Date()
            }
            sessionStreams[sid] = stream
        }
    }

    private func parseStartedAt(_ rawStartedAt: Double) -> Date {
        let seconds = rawStartedAt > 10_000_000_000 ? rawStartedAt / 1000 : rawStartedAt
        return Date(timeIntervalSince1970: seconds)
    }

    private func upsertAgentActivity(_ activity: AgentActivity, for sid: String) {
        guard let stream = sessionStreams[sid] else { return }
        if let index = stream.activeAgentActivities.firstIndex(where: { $0.id == activity.id }) {
            stream.activeAgentActivities[index] = activity
        } else {
            stream.activeAgentActivities.append(activity)
        }
        if sid == sessionId {
            recomputeDerivations()
        }
    }

    private func hasTerminalAssistantMessage(for sid: String) -> Bool {
        for message in messages.reversed() {
            if !message.sessionId.isEmpty && message.sessionId != sid {
                continue
            }
            return message.role == .assistant
        }
        return false
    }

    private func finalizeMessage(sessionId sid: String, durationMs: Int?, cancelled: Bool,
                                 errorDetail: String? = nil,
                                 inputTokens: Int? = nil, outputTokens: Int? = nil,
                                 contextUsedTokens: Int? = nil, contextWindowTokens: Int? = nil) {
        guard let stream = sessionStreams[sid] else { return }

        let isActive = sid == sessionId
        let hasContent = !stream.currentText.isEmpty || !stream.activeToolCalls.isEmpty
            || !stream.activeAgentActivities.isEmpty || !stream.currentThinking.isEmpty

        // Remove the stream slot before appending the finalized message so the
        // chat view never shows both at once. A store-owned failed send is not
        // tied to this turn, so it is carried across the finalization.
        let preservedFailedSend = stream.failedSend
        sessionStreams.removeValue(forKey: sid)
        if let preservedFailedSend {
            let slot = SessionStreamState()
            slot.failedSend = preservedFailedSend
            sessionStreams[sid] = slot
        }

        if isActive {
            if hasContent {
                let msg = ChatMessage(
                    id: UUID().uuidString,
                    sessionId: sid,
                    role: .assistant,
                    content: stream.currentText,
                    images: nil,
                    toolCalls: stream.activeToolCalls.isEmpty ? nil : stream.activeToolCalls,
                    agentActivities: stream.activeAgentActivities.isEmpty ? nil : stream.activeAgentActivities,
                    thinkingContent: stream.currentThinking.isEmpty ? nil : stream.currentThinking,
                    timestamp: Self.outgoingTimestampFormatter.string(from: Date()),
                    cancelled: cancelled ? true : nil,
                    errorDetail: errorDetail,
                    durationMs: durationMs,
                    inputTokens: inputTokens,
                    outputTokens: outputTokens,
                    contextUsedTokens: contextUsedTokens,
                    contextWindowTokens: contextWindowTokens
                )
                messages.append(msg)
            } else if cancelled {
                let msg = ChatMessage(
                    id: UUID().uuidString,
                    sessionId: sid,
                    role: .assistant,
                    content: "",
                    images: nil, toolCalls: nil, thinkingContent: nil,
                    timestamp: Self.outgoingTimestampFormatter.string(from: Date()),
                    cancelled: true, errorDetail: errorDetail,
                    durationMs: nil
                )
                messages.append(msg)
            }
            cacheMessages(messages, for: sid)
        }
    }

    private func cacheMessages(_ msgs: [ChatMessage], for sid: String) {
        messagesBySession[sid] = msgs
        cacheOrder.removeAll { $0 == sid }
        cacheOrder.append(sid)
        while cacheOrder.count > maxCachedSessions {
            guard let victim = cacheOrder.first(where: { $0 != sessionId }) else { break }
            cacheOrder.removeAll { $0 == victim }
            messagesBySession.removeValue(forKey: victim)
            serverHistory.removeValue(forKey: victim)
            lastHistoryFetchAt.removeValue(forKey: victim)
        }
    }

    func isHistoryFresh(_ sessionId: String?, within seconds: TimeInterval) -> Bool {
        guard let sessionId, let at = lastHistoryFetchAt[sessionId] else { return false }
        return Date().timeIntervalSince(at) < seconds
    }

    func loadHistoryIfNeeded(
        for sessionId: String,
        freshnessWindow: TimeInterval = 5,
        fetch: (_ since: String?) async throws -> [ChatMessage]
    ) async {
        guard self.sessionId == sessionId else { return }
        if cachedMessages(for: sessionId) != nil, isHistoryFresh(sessionId, within: freshnessWindow) {
            return
        }
        let requestToken = beginHistoryRequest(for: sessionId)
        let since = lastServerMessageId(for: sessionId)
        do {
            let msgs = try await fetch(since)
            guard self.sessionId == sessionId,
                  historyToken(for: sessionId) == requestToken else { return }
            if since != nil {
                applyIncrementalHistory(msgs, for: sessionId)
            } else {
                applyFetchedHistory(msgs, for: sessionId)
            }
        } catch {
        }
    }

    func handleMemoryWarning() {
        let keep = sessionId
        messagesBySession = messagesBySession.filter { $0.key == keep }
        serverHistory = serverHistory.filter { $0.key == keep }
        lastHistoryFetchAt = lastHistoryFetchAt.filter { $0.key == keep }
        cacheOrder = cacheOrder.filter { $0 == keep }
    }

    /// Derive pending tool inputs from history — mirrors frontend's derivePendingToolInputsFromHistory.
    /// If the last assistant message has unanswered AskUserQuestion/ExitPlanMode tool calls
    /// with no user message after, they become pending.
    private func derivePendingToolInputsFromHistory(_ msgs: [ChatMessage]) -> [PendingToolInput] {
        guard let lastAssistantIdx = msgs.lastIndex(where: { $0.role == .assistant }) else {
            return []
        }
        let hasUserAfter = msgs[(lastAssistantIdx + 1)...].contains { $0.role == .user }
        if hasUserAfter { return [] }

        let toolCalls = msgs[lastAssistantIdx].toolCalls ?? []
        return toolCalls
            .filter { $0.name == "AskUserQuestion" || $0.name == "ExitPlanMode" }
            .map { tool in
                PendingToolInput(
                    sessionId: msgs[lastAssistantIdx].sessionId,
                    requestId: "history-\(tool.id)",
                    toolName: tool.name,
                    toolUseId: tool.id,
                    input: tool.input
                )
            }
    }
}

/// Tool-call ids of AskUserQuestion calls whose question was dismissed —
/// an assistant message immediately followed by a user "Question dismissed.".
func deriveDismissedToolCallIds(from messages: [ChatMessage]) -> Set<String> {
    var ids = Set<String>()
    for (message, next) in zip(messages, messages.dropFirst()) {
        guard message.role == .assistant, next.role == .user,
              next.content == "Question dismissed." else { continue }
        for tool in message.toolCalls ?? [] where tool.name == "AskUserQuestion" {
            ids.insert(tool.id)
        }
    }
    return ids
}

// MARK: - Pending Tool Input

struct PendingToolInput: Identifiable, Equatable {
    var id: String { requestId }
    let sessionId: String
    let requestId: String
    let toolName: String
    let toolUseId: String
    let input: String
}

/// A store-owned failed send. Rendered as a distinct error row (never a fake
/// assistant message) so it survives history refetches and can be retried.
struct FailedSend: Identifiable, Equatable {
    enum Retry: Equatable {
        case message(content: String, images: [ImageAttachment]?, options: MessageOptions?)
        case toolInput(PendingToolInput)
    }

    let id: String
    let sessionId: String
    let content: String
    var reason: String
    let retry: Retry
}
