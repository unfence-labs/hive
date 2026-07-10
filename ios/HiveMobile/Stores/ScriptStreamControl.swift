import Foundation

enum ScriptStreamControl: Equatable {
    case ready
    case exit(code: Int?)
    case error(message: String?)

    static func parse(_ raw: String) -> ScriptStreamControl? {
        guard let data = raw.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = object["type"] as? String else { return nil }
        switch type {
        case "ready": return .ready
        case "exit": return .exit(code: object["code"] as? Int)
        case "error": return .error(message: object["message"] as? String)
        default: return nil
        }
    }
}
