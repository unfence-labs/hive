import Foundation

enum APIError: Error, LocalizedError {
    case invalidURL
    case httpError(statusCode: Int, message: String)
    case decodingError(Error)
    case networkError(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL: "Invalid URL"
        case .httpError(let code, let msg): "HTTP \(code): \(msg)"
        case .decodingError(let err): "Decoding error: \(err.localizedDescription)"
        case .networkError(let err): "Network error: \(err.localizedDescription)"
        }
    }

    /// A rejected-credentials failure (wrong or expired token) rather than a
    /// transport problem.
    var isAuthFailure: Bool {
        if case .httpError(let code, _) = self { return code == 401 || code == 403 }
        return false
    }
}

/// Classified outcome of a connection health probe, so a wrong token can be
/// surfaced distinctly from an unreachable server.
enum ConnectionHealth: Equatable {
    case connected
    case unreachable
    case invalidToken

    /// Map a failed probe to a health state: a 401/403 means the token is
    /// invalid; anything else is treated as unreachable.
    static func classify(error: Error) -> ConnectionHealth {
        if let apiError = error as? APIError, apiError.isAuthFailure {
            return .invalidToken
        }
        return .unreachable
    }
}

final class APIClient {
    private let session = HiveHTTP.session
    private let decoder = JSONDecoder()

    private var baseURL: String {
        let host = UserDefaults.standard.string(forKey: "serverHost") ?? "localhost"
        let port = UserDefaults.standard.string(forKey: "serverPort") ?? "3000"
        return "http://\(host):\(port)"
    }

    private var authToken: String {
        UserDefaults.standard.string(forKey: "authToken") ?? ""
    }

    private func pathSegment(_ value: String) -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    // MARK: - Generic request methods

    private func request<T: Decodable>(_ method: String, path: String, body: Data? = nil) async throws -> T {
        guard let url = URL(string: "\(baseURL)\(path)") else {
            throw APIError.invalidURL
        }

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.cachePolicy = method == "GET" ? .reloadRevalidatingCacheData : .reloadIgnoringLocalCacheData
        if !authToken.isEmpty {
            req.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = body
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch is CancellationError {
            throw CancellationError()
        } catch let urlError as URLError where urlError.code == .cancelled {
            // Only treat as cancellation if the Swift task itself was cancelled
            // (e.g. SwiftUI view disappeared). Otherwise the network layer aborted
            // the request (connection dropped, server unreachable) — surface that.
            if Task.isCancelled { throw CancellationError() }
            throw APIError.networkError(urlError)
        } catch {
            throw APIError.networkError(error)
        }

        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            let msg = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw APIError.httpError(statusCode: http.statusCode, message: msg)
        }

        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }

    /// Fire-and-forget variant for endpoints that return no body (e.g. 204).
    private func requestVoid(_ method: String, path: String, body: Data? = nil) async throws {
        guard let url = URL(string: "\(baseURL)\(path)") else {
            throw APIError.invalidURL
        }

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.cachePolicy = .reloadIgnoringLocalCacheData
        if !authToken.isEmpty {
            req.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = body
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch is CancellationError {
            throw CancellationError()
        } catch let urlError as URLError where urlError.code == .cancelled {
            if Task.isCancelled { throw CancellationError() }
            throw APIError.networkError(urlError)
        } catch {
            throw APIError.networkError(error)
        }

        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            let msg = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw APIError.httpError(statusCode: http.statusCode, message: msg)
        }
    }

    private func get<T: Decodable>(path: String) async throws -> T {
        try await request("GET", path: path)
    }

    private func post<T: Decodable>(path: String, body: Data? = nil) async throws -> T {
        try await request("POST", path: path, body: body)
    }

    // MARK: - Typed endpoints

    func checkHealth() async throws -> Bool {
        struct HealthResponse: Decodable { let status: String }
        let resp: HealthResponse = try await get(path: "/health")
        return resp.status == "ok"
    }

    func fetchProjects() async throws -> [Project] {
        try await get(path: "/api/projects")
    }

    func fetchUiPreferences() async throws -> UiPreferencesPayload {
        try await get(path: "/api/ui-preferences")
    }

    func createWorkspace(projectId: String) async throws -> Workspace {
        try await post(path: "/api/projects/\(projectId)/workspaces")
    }

    func createProject(url: String) async throws -> Project {
        let body = try JSONEncoder().encode(["url": url])
        return try await post(path: "/api/projects", body: body)
    }

    func createNewProject(name: String, visibility: String?) async throws -> Project {
        var dict: [String: String] = ["mode": "create", "name": name]
        if let visibility { dict["visibility"] = visibility }
        let body = try JSONEncoder().encode(dict)
        return try await post(path: "/api/projects", body: body)
    }

    func fetchAccountStatus() async throws -> AccountStatusResponse {
        try await get(path: "/api/account/status")
    }

    func fetchSessions(workspaceId: String) async throws -> [SessionMetadata] {
        try await get(path: "/api/workspaces/\(workspaceId)/sessions")
    }

    func fetchMessages(workspaceId: String, sessionId: String, since: String? = nil) async throws -> [ChatMessage] {
        var path = "/api/workspaces/\(workspaceId)/sessions/\(sessionId)/messages"
        if let since, let encoded = since.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            path += "?since=\(encoded)"
        }
        return try await get(path: path)
    }

    func createSession(workspaceId: String) async throws -> SessionMetadata {
        try await post(path: "/api/workspaces/\(workspaceId)/sessions")
    }

    func deleteSession(workspaceId: String, sessionId: String) async throws {
        try await requestVoid("DELETE", path: "/api/workspaces/\(workspaceId)/sessions/\(sessionId)")
    }

    func fetchFileCompletions(workspaceId: String) async throws -> [String] {
        let resp: FileCompletionsResponse = try await get(path: "/api/workspaces/\(workspaceId)/file-completions")
        return resp.files
    }

    func fetchCompletions(workspaceId: String, provider: String?) async throws -> [CompletionItem] {
        var path = "/api/workspaces/\(workspaceId)/completions"
        if let provider, !provider.isEmpty {
            path += "?provider=\(pathSegment(provider))"
        }
        let resp: CompletionsResponse = try await get(path: path)
        return resp.items
    }

    // MARK: - Automations

    func fetchAutomations() async throws -> [Automation] {
        try await get(path: "/api/automations")
    }

    func fetchAutomationRuns(automationId: String) async throws -> [AutomationRun] {
        try await get(path: "/api/automations/\(pathSegment(automationId))/runs")
    }

    func fetchAutomationRunLog(automationId: String, runId: String) async throws -> AutomationRunLog {
        try await get(path: "/api/automations/\(pathSegment(automationId))/runs/\(pathSegment(runId))/messages")
    }

    func archiveWorkspace(workspaceId: String) async throws {
        try await requestVoid("POST", path: "/api/workspaces/\(workspaceId)/archive")
    }

    func fetchWorkspaceDiff(workspaceId: String, scope: String) async throws -> DiffResponse {
        try await get(path: "/api/workspaces/\(pathSegment(workspaceId))/diff?scope=\(scope)")
    }

    func fetchWorkspaceDiffStat(workspaceId: String) async throws -> DiffStatResponse {
        try await get(path: "/api/workspaces/\(pathSegment(workspaceId))/diff/stat")
    }

    func fetchModels() async throws -> ModelCatalogResponse {
        try await get(path: "/api/models")
    }

    func fetchWorkspaceScripts(workspaceId: String) async throws -> WorkspaceScriptsResponse {
        try await get(path: "/api/workspaces/\(workspaceId)/scripts")
    }

    func startWorkspaceScript(workspaceId: String, scriptId: String) async throws {
        let scriptPath = pathSegment(scriptId)
        try await requestVoid("POST", path: "/api/workspaces/\(workspaceId)/scripts/\(scriptPath)/start")
    }

    func stopWorkspaceScript(workspaceId: String, scriptId: String) async throws {
        let scriptPath = pathSegment(scriptId)
        try await requestVoid("POST", path: "/api/workspaces/\(workspaceId)/scripts/\(scriptPath)/stop")
    }

    // MARK: - Brain

    func fetchBrain() async throws -> BrainState {
        try await get(path: "/api/brain")
    }

    func fetchBrainStatus() async throws -> BrainStatusResponse {
        try await get(path: "/api/brain/status")
    }

    func fetchBrainDiff() async throws -> BrainDiffResponse {
        try await get(path: "/api/brain/diff")
    }

    func saveBrain(message: String?) async throws -> BrainSaveResponse {
        struct SaveBody: Encodable { let message: String? }
        let body = try JSONEncoder().encode(SaveBody(message: message))
        return try await post(path: "/api/brain/save", body: body)
    }

    func registerDeviceToken(_ token: String) async throws {
        let body = try JSONEncoder().encode(["token": token])
        try await requestVoid("POST", path: "/api/devices/apns", body: body)
    }
}
