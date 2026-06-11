import Foundation

enum HubPrPollingSelection {
    static func allWorkspaceIds(in sections: [HubSection]) -> [String] {
        var ids: [String] = []
        var seen = Set<String>()

        for section in sections {
            for node in section.projects {
                for workspace in node.project.workspaces where !seen.contains(workspace.id) {
                    seen.insert(workspace.id)
                    ids.append(workspace.id)
                }
            }
        }

        return ids
    }
}
