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

}

final class APIClient {
    private let session = HiveHTTP.session
    private let decoder = JSONDecoder()
    private let connection: ServerConnection?

    init() {
        connection = ServerConnectionStore.shared.snapshot()
    }

    init(connection: ServerConnection) {
        self.connection = connection
    }

    private func requestURL(connection: ServerConnection, path: String) -> URL? {
        guard var components = URLComponents(string: path) else { return nil }
        components.scheme = "http"
        components.host = connection.host
        components.port = connection.port
        return components.url
    }

    private func pathSegment(_ value: String) -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    /// Percent-encode a query value; also encodes `&=+?#`, which are legal in
    /// a query but change its meaning.
    static func queryValue(_ value: String) -> String {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&=+?#")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    // MARK: - Generic request methods

    private func request<T: Decodable>(_ method: String, path: String, body: Data? = nil) async throws -> T {
        guard let connection,
              let url = requestURL(connection: connection, path: path) else {
            throw APIError.invalidURL
        }

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.cachePolicy = method == "GET" ? .reloadRevalidatingCacheData : .reloadIgnoringLocalCacheData
        req.setValue("Bearer \(connection.authToken)", forHTTPHeaderField: "Authorization")
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
        guard let connection,
              let url = requestURL(connection: connection, path: path) else {
            throw APIError.invalidURL
        }

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.setValue("Bearer \(connection.authToken)", forHTTPHeaderField: "Authorization")
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

    func fetchProjects() async throws -> [Project] {
        try await get(path: "/api/projects")
    }

    func fetchUiPreferences() async throws -> UiPreferencesPayload {
        try await get(path: "/api/ui-preferences")
    }

    func createWorkspace(projectId: String) async throws -> Workspace {
        try await post(path: "/api/projects/\(pathSegment(projectId))/workspaces")
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
        try await get(path: "/api/workspaces/\(pathSegment(workspaceId))/sessions")
    }

    func fetchMessages(workspaceId: String, sessionId: String, since: String? = nil) async throws -> [ChatMessage] {
        var path = "/api/workspaces/\(pathSegment(workspaceId))/sessions/\(pathSegment(sessionId))/messages"
        if let since, let encoded = since.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            path += "?since=\(encoded)"
        }
        return try await get(path: path)
    }

    func createSession(workspaceId: String) async throws -> SessionMetadata {
        try await post(path: "/api/workspaces/\(pathSegment(workspaceId))/sessions")
    }

    func deleteSession(workspaceId: String, sessionId: String) async throws {
        try await requestVoid("DELETE", path: "/api/workspaces/\(pathSegment(workspaceId))/sessions/\(pathSegment(sessionId))")
    }

    func fetchFileCompletions(workspaceId: String) async throws -> [String] {
        let resp: FileCompletionsResponse = try await get(path: "/api/workspaces/\(pathSegment(workspaceId))/file-completions")
        return resp.files
    }

    func fetchCompletions(workspaceId: String, provider: String?) async throws -> [CompletionItem] {
        var path = "/api/workspaces/\(pathSegment(workspaceId))/completions"
        if let provider, !provider.isEmpty {
            path += "?provider=\(Self.queryValue(provider))"
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
        try await requestVoid("POST", path: "/api/workspaces/\(pathSegment(workspaceId))/archive")
    }

    func fetchWorkspaceDiff(workspaceId: String, scope: String) async throws -> DiffResponse {
        try await get(path: "/api/workspaces/\(pathSegment(workspaceId))/diff?scope=\(scope)")
    }

    func fetchWorkspaceDiffStat(workspaceId: String) async throws -> DiffStatResponse {
        try await get(path: "/api/workspaces/\(pathSegment(workspaceId))/diff/stat")
    }

    func fetchWorkspaceFileContent(workspaceId: String, path: String) async throws -> WorkspaceFileContentResponse {
        try await get(path: "/api/workspaces/\(pathSegment(workspaceId))/file?path=\(Self.queryValue(path))")
    }

    func fetchModels() async throws -> ModelCatalogResponse {
        try await get(path: "/api/models")
    }

    func fetchWorkspaceScripts(workspaceId: String) async throws -> WorkspaceScriptsResponse {
        try await get(path: "/api/workspaces/\(pathSegment(workspaceId))/scripts")
    }

    func startWorkspaceScript(workspaceId: String, scriptId: String) async throws {
        let scriptPath = pathSegment(scriptId)
        try await requestVoid("POST", path: "/api/workspaces/\(pathSegment(workspaceId))/scripts/\(scriptPath)/start")
    }

    func stopWorkspaceScript(workspaceId: String, scriptId: String) async throws {
        let scriptPath = pathSegment(scriptId)
        try await requestVoid("POST", path: "/api/workspaces/\(pathSegment(workspaceId))/scripts/\(scriptPath)/stop")
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
}
