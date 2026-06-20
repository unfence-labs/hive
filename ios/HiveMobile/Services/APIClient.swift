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
    private let session = URLSession.shared
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

    /// Fetch a REST history page (PRD #254): `{ messages, hasMore }`. `limit`
    /// caps the window (backend default 200, max 1000); `before` is a message-id
    /// cursor returning the window immediately before that message (exclusive).
    /// The next page's cursor is `messages.first?.id`.
    func fetchMessages(
        workspaceId: String,
        sessionId: String,
        limit: Int? = nil,
        before: String? = nil
    ) async throws -> MessagesPage {
        var query: [URLQueryItem] = []
        if let limit { query.append(URLQueryItem(name: "limit", value: String(limit))) }
        if let before { query.append(URLQueryItem(name: "before", value: before)) }
        var path = "/api/workspaces/\(workspaceId)/sessions/\(sessionId)/messages"
        if !query.isEmpty {
            var components = URLComponents()
            components.queryItems = query
            if let suffix = components.percentEncodedQuery {
                path += "?\(suffix)"
            }
        }
        return try await get(path: path)
    }

    /// Fetch the full, untruncated output for a single tool/activity id from
    /// history (PRD #254 expand-on-demand). Resolves a ToolCall id or a
    /// command_execution activity id; 404s when absent.
    func fetchToolOutput(workspaceId: String, sessionId: String, toolId: String) async throws -> String {
        struct ToolOutputResponse: Decodable { let output: String }
        let resp: ToolOutputResponse = try await get(
            path: "/api/workspaces/\(workspaceId)/sessions/\(sessionId)/tools/\(pathSegment(toolId))/output"
        )
        return resp.output
    }

    func createSession(workspaceId: String) async throws -> SessionMetadata {
        try await post(path: "/api/workspaces/\(workspaceId)/sessions")
    }

    func deleteSession(workspaceId: String, sessionId: String) async throws {
        try await requestVoid("DELETE", path: "/api/workspaces/\(workspaceId)/sessions/\(sessionId)")
    }

    func archiveWorkspace(workspaceId: String) async throws {
        try await requestVoid("POST", path: "/api/workspaces/\(workspaceId)/archive")
    }

    func fetchModels() async throws -> ModelCatalogResponse {
        try await get(path: "/api/models")
    }

    func fetchPrStatus(workspaceId: String) async throws -> PrStatusResponse {
        try await get(path: "/api/workspaces/\(workspaceId)/pr-status")
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

    func fetchBulkPrStatus(workspaceIds: [String]) async throws -> BulkPrStatusResponse {
        let body = try JSONEncoder().encode(["workspaceIds": workspaceIds])
        return try await post(path: "/api/workspaces/pr-status/bulk", body: body)
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
