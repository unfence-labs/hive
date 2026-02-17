import Foundation

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
    case userMessage(content: String, images: [ImageAttachment]?, options: MessageOptions?, sessionId: String?)
    case stop(sessionId: String?)
    case toolInputResponse(requestId: String, toolName: String, result: ToolInputResult, sessionId: String?)

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .switchSession(let sessionId):
            try container.encode("switch_session", forKey: .type)
            try container.encode(sessionId, forKey: .sessionId)
        case .userMessage(let content, let images, let options, let sessionId):
            try container.encode("user_message", forKey: .type)
            try container.encode(content, forKey: .content)
            try container.encodeIfPresent(images, forKey: .images)
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
        case type, sessionId, content, images, options, requestId, toolName, result
    }
}

// MARK: - WsOutgoing (Backend -> Frontend)

enum WsOutgoing: Decodable {
    case textDelta(sessionId: String, text: String)
    case thinking(sessionId: String, text: String)
    case toolUse(sessionId: String, id: String, name: String, input: String, parentToolUseId: String?)
    case toolResult(sessionId: String, toolUseId: String, output: String)
    case toolInputRequired(sessionId: String, requestId: String, toolName: String, toolUseId: String, input: String)
    case done(sessionId: String, costUsd: Double?, durationMs: Int?)
    case error(message: String)
    case cancelled(sessionId: String)
    case status(status: WorkspaceStatus, sessionId: String?, streaming: Bool?, streamingStartedAt: Double?)
    case userMessage(message: ChatMessage)
    case history(messages: [ChatMessage], sessionId: String?)
    case branchInfo(info: BranchInfo)
    case diffStats(stats: DiffStatResponse)

    private enum CodingKeys: String, CodingKey {
        case type, sessionId, text, id, name, input, output
        case parentToolUseId, toolUseId, requestId, toolName
        case costUsd, durationMs, message, status, streaming, streamingStartedAt
        case messages, info, stats
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
                text: try container.decode(String.self, forKey: .text)
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
        case "done":
            self = .done(
                sessionId: try container.decode(String.self, forKey: .sessionId),
                costUsd: try container.decodeIfPresent(Double.self, forKey: .costUsd),
                durationMs: try container.decodeIfPresent(Int.self, forKey: .durationMs)
            )
        case "error":
            self = .error(message: try container.decode(String.self, forKey: .message))
        case "cancelled":
            self = .cancelled(sessionId: try container.decode(String.self, forKey: .sessionId))
        case "status":
            self = .status(
                status: try container.decode(WorkspaceStatus.self, forKey: .status),
                sessionId: try container.decodeIfPresent(String.self, forKey: .sessionId),
                streaming: try container.decodeIfPresent(Bool.self, forKey: .streaming),
                streamingStartedAt: try container.decodeIfPresent(Double.self, forKey: .streamingStartedAt)
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
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .type, in: container,
                debugDescription: "Unknown WsOutgoing type: \(type)"
            )
        }
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
