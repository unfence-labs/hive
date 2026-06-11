import Testing
@testable import HiveMobileStoresCore

struct HubPrPollingSelectionTests {
    @Test
    func returnsWorkspacesFromCollapsedSections() {
        let projects = [
            makeProject("p1", name: "alpha"),
            makeProject("p2", name: "beta"),
            makeProject("p3", name: "gamma")
        ]
        let preferences = SidebarProjectFoldersState(
            folders: [
                SidebarProjectFolder(id: "f-client", name: "Client", projectIds: ["p1", "p2"])
            ],
            folderOpenState: ["f-client": false]
        )

        let sections = HubOrganization.sections(projects: projects, preferences: preferences)
        let ids = HubPrPollingSelection.allWorkspaceIds(in: sections)

        #expect(sections[0].defaultExpanded == false)
        #expect(ids == ["ws-p1", "ws-p2", "ws-p3"])
    }

    @Test
    func returnsWorkspacesFromProjectsWithoutLiveAttention() {
        let projects = [
            makeProject("p1", name: "alpha"),
            makeProject("p2", name: "beta")
        ]

        let sections = HubOrganization.sections(projects: projects, preferences: .empty)
        let ids = HubPrPollingSelection.allWorkspaceIds(in: sections)

        #expect(ids == ["ws-p1", "ws-p2"])
    }

    @Test
    func dedupesWorkspaceIdsPreservingFirstSeenOrder() {
        let projects = [
            makeProject("p1", name: "alpha", workspaceIds: ["ws-shared", "ws-p1b"]),
            makeProject("p2", name: "beta", workspaceIds: ["ws-shared", "ws-p2"]),
            makeProject("p3", name: "gamma", workspaceIds: ["ws-p1b", "ws-p3"])
        ]
        let preferences = SidebarProjectFoldersState(
            folders: [
                SidebarProjectFolder(id: "f-client", name: "Client", projectIds: ["p1", "p2"])
            ],
            folderOpenState: [:]
        )

        let sections = HubOrganization.sections(projects: projects, preferences: preferences)
        let ids = HubPrPollingSelection.allWorkspaceIds(in: sections)

        #expect(ids == ["ws-shared", "ws-p1b", "ws-p2", "ws-p3"])
    }

    @Test
    func returnsEmptyArrayForEmptySections() {
        let ids = HubPrPollingSelection.allWorkspaceIds(in: [])

        #expect(ids == [])
    }

    private func makeProject(
        _ id: String,
        name: String,
        workspaceIds: [String]? = nil
    ) -> Project {
        let ids = workspaceIds ?? ["ws-\(id)"]
        return Project(
            id: id,
            name: name,
            url: "https://github.com/acme/\(name).git",
            createdAt: "2026-01-01T00:00:00Z",
            workspaces: ids.map { workspaceId in
                Workspace(
                    id: workspaceId,
                    name: "\(name)-\(workspaceId)",
                    branch: "main",
                    status: .idle,
                    createdAt: "2026-01-01T00:00:00Z",
                    activeSessionId: nil,
                    projectName: name,
                    defaultBranch: "main",
                    sessionCount: 1,
                    projectId: id,
                    hasFavicon: false
                )
            },
            hasFavicon: false
        )
    }
}
