import Foundation

// MARK: - Hub WebSocket Protocol (Multiplexed)

/// Server -> Client (hub-level). Every outgoing event is tagged with its workspace.
struct HubOutgoing: Decodable {
    let workspaceId: String
    let event: WsOutgoing
}

/// Client -> Server (hub-level).
enum HubIncoming: Encodable {
    case syncWorkspaces(
        workspaceIds: [String],
        focusWorkspaces: [String],
        prWorkspaces: [String],
        forceBootstrap: Bool = false
    )
    case workspaceEvent(workspaceId: String, event: WsIncoming)

    func encode(to encoder: Encoder) throws {
        switch self {
        case .syncWorkspaces(let workspaceIds, let focusWorkspaces, let prWorkspaces, let forceBootstrap):
            var container = encoder.container(keyedBy: SyncCodingKeys.self)
            try container.encode("sync_workspaces", forKey: .type)
            try container.encode(workspaceIds, forKey: .workspaceIds)
            try container.encode(focusWorkspaces, forKey: .focusWorkspaces)
            try container.encode(prWorkspaces, forKey: .prWorkspaces)
            // Only encode when true so the routine sync payload stays small.
            if forceBootstrap {
                try container.encode(forceBootstrap, forKey: .forceBootstrap)
            }
        case .workspaceEvent(let workspaceId, let event):
            var container = encoder.container(keyedBy: EventCodingKeys.self)
            try container.encode(workspaceId, forKey: .workspaceId)
            try container.encode(event, forKey: .event)
        }
    }

    private enum SyncCodingKeys: String, CodingKey {
        case type, workspaceIds, focusWorkspaces, prWorkspaces, forceBootstrap
    }

    private enum EventCodingKeys: String, CodingKey {
        case workspaceId, event
    }
}

// MARK: - Tool Input Result (Encodable)

enum ToolInputResult: Encodable {
    case answer(answers: [QuestionAnswer], questions: [QuestionInput]?)
    case approve
    case reject(message: String?)
    case dismiss(message: String?)

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .answer(let answers, let questions):
            try container.encode("answer", forKey: .type)
            try container.encode(answers, forKey: .answers)
            try container.encodeIfPresent(questions, forKey: .questions)
        case .approve:
            try container.encode("approve", forKey: .type)
        case .reject(let message):
            try container.encode("reject", forKey: .type)
            try container.encodeIfPresent(message, forKey: .message)
        case .dismiss(let message):
            try container.encode("dismiss", forKey: .type)
            try container.encodeIfPresent(message, forKey: .message)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case type, answers, questions, message
    }
}

// MARK: - WsIncoming (Frontend -> Backend)

enum WsIncoming: Encodable {
    case switchSession(sessionId: String)
    case userMessage(content: String, images: [ImageAttachment]?, fileMentions: [FileMention]?, options: MessageOptions?, sessionId: String?)
    case stop(sessionId: String?)
    case toolInputResponse(requestId: String, toolName: String, result: ToolInputResult, sessionId: String?)

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .switchSession(let sessionId):
            try container.encode("switch_session", forKey: .type)
            try container.encode(sessionId, forKey: .sessionId)
        case .userMessage(let content, let images, let fileMentions, let options, let sessionId):
            try container.encode("user_message", forKey: .type)
            try container.encode(content, forKey: .content)
            try container.encodeIfPresent(images, forKey: .images)
            try container.encodeIfPresent(fileMentions, forKey: .fileMentions)
            try container.encodeIfPresent(options, forKey: .options)
            try container.encodeIfPresent(sessionId, forKey: .sessionId)
        case .stop(let sessionId):
            try container.encode("stop", forKey: .type)
            try container.encodeIfPresent(sessionId, forKey: .sessionId)
        case .toolInputResponse(let requestId, let toolName, let result, let sessionId):
            try container.encode("tool_input_response", forKey: .type)
            try container.encode(requestId, forKey: .requestId)
            try container.encode(toolName, forKey: .toolName)
            try container.encode(result, forKey: .result)
            try container.encodeIfPresent(sessionId, forKey: .sessionId)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case type, sessionId, content, images, fileMentions, options, requestId, toolName, result
    }
}

// MARK: - WsOutgoing (Backend -> Frontend)

enum WsOutgoing: Decodable {
    case textDelta(sessionId: String, text: String)
    case thinking(sessionId: String, text: String, segmentId: String? = nil)
    case toolUse(sessionId: String, id: String, name: String, input: String, parentToolUseId: String?)
    case toolResult(sessionId: String, toolUseId: String, output: String)
    case agentActivity(sessionId: String, activity: AgentActivity)
    case streamSnapshot(sessionId: String, text: String, thinking: String, toolCalls: [ToolCall],
                        agentActivities: [AgentActivity], agentPlanMode: Bool,
                        streamingStartedAt: Double?, reasoningSegments: [ReasoningSegment] = [])
    case toolInputRequired(sessionId: String, requestId: String, toolName: String, toolUseId: String, input: String)
    case toolInputResolved(sessionId: String)
    case done(sessionId: String, durationMs: Int?, inputTokens: Int?, outputTokens: Int?, contextUsedTokens: Int?, contextWindowTokens: Int?, pendingToolName: String?)
    case error(message: String, sessionId: String?)
    case cancelled(sessionId: String, errorDetail: String?, userInitiated: Bool?, durationMs: Int?)
    case status(status: WorkspaceStatus, sessionId: String?, streaming: Bool?, streamingStartedAt: Double?, lockedProvider: String?)
    case userMessage(message: ChatMessage)
    case history(messages: [ChatMessage], sessionId: String?)
    case branchInfo(info: BranchInfo)
    case diffStats(stats: DiffStatResponse)
    case prStatus(status: PrStatusResponse)
    case scriptStatus(scriptType: String, state: String, exitCode: Int?)
    case planModeChanged(sessionId: String, active: Bool)
    case unknown(type: String)

    private enum CodingKeys: String, CodingKey {
        case type, sessionId, text, id, name, input, output, segmentId
        case activity
        case thinking, reasoningSegments, toolCalls, agentActivities, agentPlanMode
        case parentToolUseId, toolUseId, requestId, toolName
        case durationMs, inputTokens, outputTokens, contextUsedTokens, contextWindowTokens, pendingToolName
        case errorDetail, userInitiated
        case message, status, streaming, streamingStartedAt, lockedProvider
        case messages, info, stats
        case scriptType, state, exitCode
        case active
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)

        switch type {
        case "text_delta":
            self = .textDelta(
                sessionId: try container.decode(String.self, forKey: .sessionId),
                text: try container.decode(String.self, forKey: .text)
            )
        case "thinking":
            self = .thinking(
                sessionId: try container.decode(String.self, forKey: .sessionId),
                text: try container.decode(String.self, forKey: .text),
                segmentId: try container.decodeIfPresent(String.self, forKey: .segmentId)
            )
        case "tool_use":
            self = .toolUse(
                sessionId: try container.decode(String.self, forKey: .sessionId),
                id: try container.decode(String.self, forKey: .id),
                name: try container.decode(String.self, forKey: .name),
                input: try container.decode(String.self, forKey: .input),
                parentToolUseId: try container.decodeIfPresent(String.self, forKey: .parentToolUseId)
            )
        case "tool_result":
            self = .toolResult(
                sessionId: try container.decode(String.self, forKey: .sessionId),
                toolUseId: try container.decode(String.self, forKey: .toolUseId),
                output: try container.decode(String.self, forKey: .output)
            )
        case "agent_activity":
            self = .agentActivity(
                sessionId: try container.decode(String.self, forKey: .sessionId),
                activity: try container.decode(AgentActivity.self, forKey: .activity)
            )
        case "stream_snapshot":
            self = .streamSnapshot(
                sessionId: try container.decode(String.self, forKey: .sessionId),
                text: try container.decodeIfPresent(String.self, forKey: .text) ?? "",
                thinking: try container.decodeIfPresent(String.self, forKey: .thinking) ?? "",
                toolCalls: try container.decodeIfPresent([ToolCall].self, forKey: .toolCalls) ?? [],
                agentActivities: try container.decodeIfPresent([AgentActivity].self, forKey: .agentActivities) ?? [],
                agentPlanMode: try container.decodeIfPresent(Bool.self, forKey: .agentPlanMode) ?? false,
                streamingStartedAt: try container.decodeIfPresent(Double.self, forKey: .streamingStartedAt),
                reasoningSegments: try container.decodeIfPresent([ReasoningSegment].self, forKey: .reasoningSegments) ?? []
            )
        case "tool_input_required":
            let sessionId = try container.decode(String.self, forKey: .sessionId)
            let requestId = try container.decode(String.self, forKey: .requestId)
            let toolName = try container.decode(String.self, forKey: .toolName)
            let toolUseId = try container.decode(String.self, forKey: .toolUseId)
            // input is `unknown` in TS — re-encode whatever JSON value we get as a string
            let inputValue = try? container.decode(AnyCodableValue.self, forKey: .input)
            let inputString: String
            if let value = inputValue, let data = try? JSONEncoder().encode(value) {
                inputString = String(data: data, encoding: .utf8) ?? "{}"
            } else {
                inputString = "{}"
            }
            self = .toolInputRequired(
                sessionId: sessionId, requestId: requestId,
                toolName: toolName, toolUseId: toolUseId, input: inputString
            )
        case "tool_input_resolved":
            self = .toolInputResolved(
                sessionId: try container.decode(String.self, forKey: .sessionId)
            )
        case "done":
            let doneSessionId = try container.decode(String.self, forKey: .sessionId)
            // durationMs may be Int or Double from the backend
            let doneDuration: Int?
            if let intVal = try? container.decodeIfPresent(Int.self, forKey: .durationMs) {
                doneDuration = intVal
            } else if let doubleVal = try? container.decodeIfPresent(Double.self, forKey: .durationMs) {
                doneDuration = Int(doubleVal)
            } else {
                doneDuration = nil
            }
            let doneInputTokens: Int?
            if let intVal = try? container.decodeIfPresent(Int.self, forKey: .inputTokens) {
                doneInputTokens = intVal
            } else if let doubleVal = try? container.decodeIfPresent(Double.self, forKey: .inputTokens) {
                doneInputTokens = Int(doubleVal)
            } else {
                doneInputTokens = nil
            }
            let doneOutputTokens: Int?
            if let intVal = try? container.decodeIfPresent(Int.self, forKey: .outputTokens) {
                doneOutputTokens = intVal
            } else if let doubleVal = try? container.decodeIfPresent(Double.self, forKey: .outputTokens) {
                doneOutputTokens = Int(doubleVal)
            } else {
                doneOutputTokens = nil
            }
            let doneContextUsedTokens: Int?
            if let intVal = try? container.decodeIfPresent(Int.self, forKey: .contextUsedTokens) {
                doneContextUsedTokens = intVal
            } else if let doubleVal = try? container.decodeIfPresent(Double.self, forKey: .contextUsedTokens) {
                doneContextUsedTokens = Int(doubleVal)
            } else {
                doneContextUsedTokens = nil
            }
            let doneContextWindowTokens: Int?
            if let intVal = try? container.decodeIfPresent(Int.self, forKey: .contextWindowTokens) {
                doneContextWindowTokens = intVal
            } else if let doubleVal = try? container.decodeIfPresent(Double.self, forKey: .contextWindowTokens) {
                doneContextWindowTokens = Int(doubleVal)
            } else {
                doneContextWindowTokens = nil
            }
            let donePendingToolName = try container.decodeIfPresent(String.self, forKey: .pendingToolName)
            self = .done(sessionId: doneSessionId, durationMs: doneDuration,
                         inputTokens: doneInputTokens, outputTokens: doneOutputTokens,
                         contextUsedTokens: doneContextUsedTokens,
                         contextWindowTokens: doneContextWindowTokens,
                         pendingToolName: donePendingToolName)
        case "error":
            self = .error(
                message: try container.decode(String.self, forKey: .message),
                sessionId: try container.decodeIfPresent(String.self, forKey: .sessionId)
            )
        case "cancelled":
            let cancelledSid = try container.decode(String.self, forKey: .sessionId)
            let cancelledErrorDetail = try container.decodeIfPresent(String.self, forKey: .errorDetail)
            let cancelledUserInitiated = try container.decodeIfPresent(Bool.self, forKey: .userInitiated)
            let cancelledDuration: Int?
            if let intVal = try? container.decodeIfPresent(Int.self, forKey: .durationMs) {
                cancelledDuration = intVal
            } else if let doubleVal = try? container.decodeIfPresent(Double.self, forKey: .durationMs) {
                cancelledDuration = Int(doubleVal)
            } else {
                cancelledDuration = nil
            }
            self = .cancelled(sessionId: cancelledSid, errorDetail: cancelledErrorDetail, userInitiated: cancelledUserInitiated, durationMs: cancelledDuration)
        case "status":
            self = .status(
                status: try container.decode(WorkspaceStatus.self, forKey: .status),
                sessionId: try container.decodeIfPresent(String.self, forKey: .sessionId),
                streaming: try container.decodeIfPresent(Bool.self, forKey: .streaming),
                streamingStartedAt: try container.decodeIfPresent(Double.self, forKey: .streamingStartedAt),
                lockedProvider: try container.decodeIfPresent(String.self, forKey: .lockedProvider)
            )
        case "user_message":
            self = .userMessage(message: try container.decode(ChatMessage.self, forKey: .message))
        case "history":
            self = .history(
                messages: try container.decode([ChatMessage].self, forKey: .messages),
                sessionId: try container.decodeIfPresent(String.self, forKey: .sessionId)
            )
        case "branch_info":
            self = .branchInfo(info: try container.decode(BranchInfo.self, forKey: .info))
        case "diff_stats":
            self = .diffStats(stats: try container.decode(DiffStatResponse.self, forKey: .stats))
        case "pr_status":
            self = .prStatus(status: try container.decode(PrStatusResponse.self, forKey: .status))
        case "script_status":
            self = .scriptStatus(
                scriptType: try container.decode(String.self, forKey: .scriptType),
                state: try container.decode(String.self, forKey: .state),
                exitCode: try container.decodeIfPresent(Int.self, forKey: .exitCode)
            )
        case "plan_mode_changed":
            self = .planModeChanged(
                sessionId: try container.decode(String.self, forKey: .sessionId),
                active: try container.decode(Bool.self, forKey: .active)
            )
        default:
            self = .unknown(type: type)
        }
    }
}

// MARK: - Hub Activity Marking

/// How a hub-level event should update a workspace's last-activity timestamp
/// (used for hub sorting). Per-token events are ignored so streaming does not
/// write observable hub state on every fragment.
enum HubActivityMarking: Equatable {
    case ignore
    case markNow
    case markLatestMessageTimestamp
    case markIfStreaming
}

func hubActivityMarking(for event: WsOutgoing) -> HubActivityMarking {
    switch event {
    case .textDelta, .thinking,
         .branchInfo, .diffStats, .prStatus, .scriptStatus, .planModeChanged, .streamSnapshot:
        return .ignore
    case .history:
        return .markLatestMessageTimestamp
    case .status:
        return .markIfStreaming
    case .toolUse, .toolResult, .agentActivity, .toolInputRequired, .toolInputResolved,
         .done, .error, .cancelled, .userMessage, .unknown:
        return .markNow
    }
}

// MARK: - AnyCodableValue (for decoding unknown JSON)

enum AnyCodableValue: Codable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case object([String: AnyCodableValue])
    case array([AnyCodableValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let v = try? container.decode(Bool.self) {
            self = .bool(v)
        } else if let v = try? container.decode(Int.self) {
            self = .int(v)
        } else if let v = try? container.decode(Double.self) {
            self = .double(v)
        } else if let v = try? container.decode(String.self) {
            self = .string(v)
        } else if let v = try? container.decode([String: AnyCodableValue].self) {
            self = .object(v)
        } else if let v = try? container.decode([AnyCodableValue].self) {
            self = .array(v)
        } else {
            self = .null
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let v): try container.encode(v)
        case .int(let v): try container.encode(v)
        case .double(let v): try container.encode(v)
        case .bool(let v): try container.encode(v)
        case .object(let v): try container.encode(v)
        case .array(let v): try container.encode(v)
        case .null: try container.encodeNil()
        }
    }
}
