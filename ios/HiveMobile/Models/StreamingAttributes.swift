import ActivityKit
import Foundation

struct StreamingAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var activeCount: Int
        var workspaceLabels: [String]  // "project — branch" per workspace
    }
}
