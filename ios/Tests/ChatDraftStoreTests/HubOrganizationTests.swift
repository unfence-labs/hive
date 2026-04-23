import Testing
@testable import HiveMobileStoresCore

struct HubOrganizationTests {
    @Test
    func buildsSectionsUsingFolderAndProjectOrder() {
        let projects = [
            makeProject("p1", name: "alpha"),
            makeProject("p2", name: "beta"),
            makeProject("p3", name: "gamma")
        ]
        let preferences = SidebarProjectFoldersState(
            folders: [
                SidebarProjectFolder(id: "f-client", name: "Client", projectIds: ["p2", "p1"]),
                SidebarProjectFolder(id: "f-infra", name: "Infra", projectIds: ["p3"])
            ],
            folderOpenState: ["f-client": false, "f-infra": true]
        )

        let sections = HubOrganization.sections(projects: projects, preferences: preferences)

        #expect(sections.map(\.title) == ["Client", "Infra"])
        #expect(projectIds(in: sections[0]) == ["p2", "p1"])
        #expect(projectIds(in: sections[1]) == ["p3"])
        #expect(sections[0].defaultExpanded == false)
        #expect(sections[1].defaultExpanded == true)
    }

    @Test
    func putsProjectsWithoutFolderRefsIntoUnfiled() {
        let projects = [
            makeProject("p1", name: "alpha"),
            makeProject("p2", name: "beta"),
            makeProject("p3", name: "gamma")
        ]
        let preferences = SidebarProjectFoldersState(
            folders: [
                SidebarProjectFolder(id: "f-client", name: "Client", projectIds: ["p2"])
            ],
            folderOpenState: [:]
        )

        let sections = HubOrganization.sections(projects: projects, preferences: preferences)

        #expect(sections.map(\.title) == ["Client", "Unfiled"])
        #expect(projectIds(in: sections[1]) == ["p1", "p3"])
        #expect(sections[1].defaultExpanded == true)
    }

    @Test
    func ignoresStaleRefsDuplicatesAndEmptyFoldersByDefault() {
        let projects = [
            makeProject("p1", name: "alpha"),
            makeProject("p2", name: "beta")
        ]
        let preferences = SidebarProjectFoldersState(
            folders: [
                SidebarProjectFolder(id: "f-one", name: "One", projectIds: ["missing", "p1", "p1"]),
                SidebarProjectFolder(id: "f-two", name: "Two", projectIds: ["p1", "p2"]),
                SidebarProjectFolder(id: "f-empty", name: "Empty", projectIds: [])
            ],
            folderOpenState: [:]
        )

        let sections = HubOrganization.sections(projects: projects, preferences: preferences)

        #expect(sections.map(\.title) == ["One", "Two"])
        #expect(projectIds(in: sections[0]) == ["p1"])
        #expect(projectIds(in: sections[1]) == ["p2"])
    }

    @Test
    func canIncludeEmptyFoldersWhenRequested() {
        let preferences = SidebarProjectFoldersState(
            folders: [
                SidebarProjectFolder(id: "f-empty", name: "Empty", projectIds: [])
            ],
            folderOpenState: ["f-empty": false]
        )

        let sections = HubOrganization.sections(
            projects: [],
            preferences: preferences,
            includeEmptyFolders: true
        )

        #expect(sections.map(\.title) == ["Empty"])
        #expect(sections[0].projectCount == 0)
        #expect(sections[0].defaultExpanded == false)
    }

    @Test
    func fallsBackToSingleUnfiledSectionWithoutPreferences() {
        let projects = [
            makeProject("p1", name: "alpha"),
            makeProject("p2", name: "beta")
        ]

        let sections = HubOrganization.sections(projects: projects, preferences: .empty)

        #expect(sections.map(\.title) == ["Unfiled"])
        #expect(projectIds(in: sections[0]) == ["p1", "p2"])
    }

    private func projectIds(in section: HubSection) -> [String] {
        section.projects.map(\.project.id)
    }

    private func makeProject(_ id: String, name: String) -> Project {
        Project(
            id: id,
            name: name,
            url: "https://github.com/acme/\(name).git",
            createdAt: "2026-01-01T00:00:00Z",
            workspaces: [
                Workspace(
                    id: "ws-\(id)",
                    name: "warsaw-\(id)",
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
            ],
            hasFavicon: false
        )
    }
}
