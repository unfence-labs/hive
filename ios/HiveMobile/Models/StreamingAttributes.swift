import ActivityKit
import Foundation

struct WorkspaceLabel: Codable, Hashable {
    var project: String
    var branch: String
}

struct StreamingAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var activeCount: Int
        var workspaces: [WorkspaceLabel]
    }
}
