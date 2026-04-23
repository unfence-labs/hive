import Foundation

enum HubSectionKind: Hashable {
    case folder(id: String, name: String)
    case unfiled

    var id: String {
        switch self {
        case .folder(let id, _): "folder:\(id)"
        case .unfiled: "unfiled"
        }
    }

    var title: String {
        switch self {
        case .folder(_, let name): name
        case .unfiled: "Unfiled"
        }
    }
}

struct HubProjectNode: Identifiable {
    let project: Project

    var id: String { project.id }
}

struct HubSection: Identifiable {
    let kind: HubSectionKind
    let projects: [HubProjectNode]
    let defaultExpanded: Bool

    var id: String { kind.id }
    var title: String { kind.title }
    var projectCount: Int { projects.count }
    var workspaceCount: Int { projects.reduce(0) { $0 + $1.project.workspaces.count } }
}

/// Builds the mobile hub hierarchy from the desktop sidebar preferences without
/// mutating those preferences. Folder management remains desktop-only.
enum HubOrganization {
    static func sections(
        projects: [Project],
        preferences: SidebarProjectFoldersState,
        includeEmptyFolders: Bool = false
    ) -> [HubSection] {
        let projectById = Dictionary(uniqueKeysWithValues: projects.map { ($0.id, $0) })
        var usedProjectIds = Set<String>()
        var sections: [HubSection] = []

        for folder in preferences.folders {
            let nodes = folder.projectIds.compactMap { projectId -> HubProjectNode? in
                guard !usedProjectIds.contains(projectId), let project = projectById[projectId] else {
                    return nil
                }
                usedProjectIds.insert(projectId)
                return HubProjectNode(project: project)
            }

            if includeEmptyFolders || !nodes.isEmpty {
                sections.append(
                    HubSection(
                        kind: .folder(id: folder.id, name: folder.name),
                        projects: nodes,
                        defaultExpanded: preferences.folderOpenState[folder.id] ?? true
                    )
                )
            }
        }

        let unfiled = projects
            .filter { !usedProjectIds.contains($0.id) }
            .map(HubProjectNode.init(project:))

        if !unfiled.isEmpty {
            sections.append(
                HubSection(
                    kind: .unfiled,
                    projects: unfiled,
                    defaultExpanded: true
                )
            )
        }

        return sections
    }
}
