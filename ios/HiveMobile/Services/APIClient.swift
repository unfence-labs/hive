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

    private func get<T: Decodable>(path: String) async throws -> T {
        try await request("GET", path: path)
    }

    private func post<T: Decodable>(path: String, body: Data? = nil) async throws -> T {
        try await request("POST", path: path, body: body)
    }

    private func delete<T: Decodable>(path: String) async throws -> T {
        try await request("DELETE", path: path)
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

    func createWorkspace(projectId: String) async throws -> Workspace {
        try await post(path: "/api/projects/\(projectId)/workspaces")
    }

    func fetchSessions(workspaceId: String) async throws -> [SessionMetadata] {
        try await get(path: "/api/workspaces/\(workspaceId)/sessions")
    }

    func fetchMessages(workspaceId: String, sessionId: String) async throws -> [ChatMessage] {
        try await get(path: "/api/workspaces/\(workspaceId)/sessions/\(sessionId)/messages")
    }

    func createSession(workspaceId: String) async throws -> SessionMetadata {
        try await post(path: "/api/workspaces/\(workspaceId)/sessions")
    }

    func activateSession(workspaceId: String, sessionId: String) async throws -> SessionMetadata {
        try await post(path: "/api/workspaces/\(workspaceId)/sessions/\(sessionId)/activate")
    }

    func deleteSession(workspaceId: String, sessionId: String) async throws {
        struct DeleteResponse: Decodable { let success: Bool }
        let _: DeleteResponse = try await delete(path: "/api/workspaces/\(workspaceId)/sessions/\(sessionId)")
    }

    func fetchDiffStats(workspaceId: String) async throws -> DiffStatResponse {
        try await get(path: "/api/workspaces/\(workspaceId)/diff-stat")
    }
}
