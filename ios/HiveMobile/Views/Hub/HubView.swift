import SwiftUI

private enum HubLayout {
    static let projectIndent: CGFloat = 16
    static let workspaceIndent: CGFloat = 12
    static let hierarchyLineInset: CGFloat = 5
}

struct HubView: View {
    @Environment(ProjectStore.self) private var store
    @State private var showAddProject = false
    @State private var workspaceToArchive: Workspace?
    @State private var sectionExpansionOverrides: [String: Bool] = HubView.loadExpansionOverrides(
        key: HubView.sectionExpansionKey
    )
    @State private var projectExpansionOverrides: [String: Bool] = HubView.loadExpansionOverrides(
        key: HubView.projectExpansionKey
    )
    @State private var searchText = ""

    var body: some View {
        ScrollView {
            if store.isLoading && store.projects.isEmpty {
                ProgressView()
                    .padding(.top, 80)
            } else if store.projects.isEmpty && !store.isLoading {
                ContentUnavailableView(
                    "No Projects",
                    systemImage: "folder",
                    description: Text("Tap + to add your first project, or connect to your Hive server from Settings.")
                )
                .padding(.top, 40)
            } else if !normalizedSearch.isEmpty && filteredSections.isEmpty {
                ContentUnavailableView(
                    "No Results",
                    systemImage: "magnifyingglass",
                    description: Text("Try a project, workspace, or branch name.")
                )
                .padding(.top, 40)
            } else {
                denseHubContent
            }
        }
        .scrollBounceBehavior(.always)
        .navigationTitle("Hub")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(
            text: $searchText,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: "Search projects, branches"
        )
        .toolbar { toolbarContent }
        .refreshable {
            // Unstructured Task shields refresh from SwiftUI prematurely
            // cancelling the .refreshable task on ScrollView (known iOS 26 regression).
            await Task { @MainActor in
                // Force WS reconnect so the backend re-sends full bootstrap
                // (status, history, branch_info, diff_stats) for all workspaces.
                store.statusMonitor.forceRefresh()
                await store.refresh()
            }.value
        }
        .task {
            // Always safe: existing data stays visible while refresh runs.
            await store.refresh()
        }
        .overlay {
            if let errorMessage = store.errorMessage {
                errorBanner(errorMessage)
            }
        }
        .overlay(alignment: .top) {
            if let repoName = store.cloningRepoName {
                HStack(spacing: HiveSpacing.sm) {
                    ProgressView()
                        .controlSize(.small)
                    Text("Cloning \(repoName)...")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, HiveSpacing.lg)
                .padding(.vertical, HiveSpacing.sm)
                .glassPill()
                .padding(.top, HiveSpacing.sm)
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.default, value: store.cloningRepoName != nil)
        .sheet(isPresented: $showAddProject) {
            AddProjectSheet(
                api: APIClient(),
                onClone: { url in
                    Task { await store.createProject(url: url) }
                },
                onCreate: { name, visibility in
                    Task { await store.createNewProject(name: name, visibility: visibility) }
                }
            )
        }
        .alert(
            "Archive workspace?",
            isPresented: Binding(
                get: { workspaceToArchive != nil },
                set: { if !$0 { workspaceToArchive = nil } }
            ),
            presenting: workspaceToArchive
        ) { ws in
            Button("Archive", role: .destructive) {
                Task { await store.archiveWorkspace(id: ws.id) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { ws in
            Text("\"\(ws.name)\" will be archived.")
        }
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button {
                showAddProject = true
            } label: {
                if store.isCreatingProject {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Image(systemName: "plus")
                        .font(.title2.weight(.semibold))
                }
            }
            .buttonStyle(.plain)
            .disabled(store.isCreatingProject)
            .accessibilityLabel("Add project")
            .accessibilityHint("Opens the add project sheet.")
        }
    }

    // MARK: - Dense Hub

    private var denseHubContent: some View {
        LazyVStack(alignment: .leading, spacing: HiveSpacing.md) {
            ForEach(filteredSections) { section in
                sectionView(section)
            }
        }
        .padding(.horizontal, HiveSpacing.lg)
        .padding(.vertical, HiveSpacing.md)
        .task(id: store.projects.flatMap { $0.workspaces.map(\.id) }) {
            let ids = store.projects.flatMap { $0.workspaces.map(\.id) }
            store.statusMonitor.syncPrPolling(visibleWorkspaceIds: ids)
        }
    }

    private var baseSections: [HubSection] {
        HubOrganization.sections(
            projects: store.projects,
            preferences: store.uiPreferences.sidebar
        )
    }

    private var filteredSections: [HubSection] {
        let query = normalizedSearch
        guard !query.isEmpty else { return baseSections }

        return baseSections.compactMap { section in
            let sectionMatches = section.title.localizedCaseInsensitiveContains(query)
            let projects = section.projects.compactMap { node -> HubProjectNode? in
                if sectionMatches || projectMatches(node.project, query: query) {
                    return node
                }

                let matchingWorkspaces = node.project.workspaces.filter {
                    workspaceMatches($0, query: query)
                }
                guard !matchingWorkspaces.isEmpty else { return nil }

                var project = node.project
                project.workspaces = matchingWorkspaces
                return HubProjectNode(project: project)
            }

            guard !projects.isEmpty else { return nil }
            return HubSection(
                kind: section.kind,
                projects: projects,
                defaultExpanded: true
            )
        }
    }

    private var normalizedSearch: String {
        searchText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func sectionView(_ section: HubSection) -> some View {
        let expanded = isSectionExpanded(section)

        return VStack(alignment: .leading, spacing: HiveSpacing.sm) {
            HubFolderHeader(
                title: section.title,
                projectCount: section.projectCount,
                workspaceCount: section.workspaceCount,
                isExpanded: expanded,
                activity: activitySummary(for: section),
                onToggle: { setSection(section, expanded: !expanded) }
            )

            if expanded {
                VStack(alignment: .leading, spacing: HiveSpacing.xs) {
                    ForEach(section.projects) { node in
                        projectView(node.project)
                    }
                }
                .padding(.leading, HubLayout.projectIndent)
                .overlay(alignment: .leading) {
                    Rectangle()
                        .fill(WhisperColor.hubStructure)
                        .frame(width: 1)
                        .padding(.leading, HubLayout.hierarchyLineInset)
                }
            }
        }
    }

    private func projectView(_ project: Project) -> some View {
        let expanded = isProjectExpanded(project)

        return VStack(alignment: .leading, spacing: HiveSpacing.xs) {
            HubProjectRow(
                project: project,
                isExpanded: expanded,
                activity: activitySummary(for: project),
                isCreatingWorkspace: store.creatingWorkspaceProjectIds.contains(project.id),
                onToggle: { setProject(project.id, expanded: !expanded) },
                onAddWorkspace: { handleCreateWorkspace(for: project.id) }
            )

            if expanded {
                if project.workspaces.isEmpty {
                    Text("No active workspaces")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                        .padding(.leading, HubLayout.workspaceIndent)
                        .padding(.vertical, HiveSpacing.xs)
                } else {
                    VStack(spacing: HiveSpacing.xs) {
                        ForEach(sortedWorkspaces(project.workspaces)) { workspace in
                            NavigationLink(value: workspace) {
                                HubWorkspaceRow(
                                    workspace: workspace,
                                    isStreaming: store.statusMonitor.isStreaming(workspace.id),
                                    turnCompleted: store.statusMonitor.isCompleted(workspace.id),
                                    diffStats: store.statusMonitor.diffStats(for: workspace.id),
                                    prStatus: store.statusMonitor.prStatus(for: workspace.id)
                                )
                            }
                            .buttonStyle(.plain)
                            .contextMenu {
                                let streaming = store.statusMonitor.isStreaming(workspace.id)
                                Button("Archive", systemImage: "archivebox", role: .destructive) {
                                    workspaceToArchive = workspace
                                }
                                .tint(streaming ? nil : .red)
                                .disabled(streaming)
                            }
                        }
                    }
                    .padding(.leading, HubLayout.workspaceIndent)
                }
            }
        }
    }

    private func sortedWorkspaces(_ workspaces: [Workspace]) -> [Workspace] {
        workspaces.enumerated().sorted { left, right in
            let leftRank = workspaceRunningRank(left.element.id)
            let rightRank = workspaceRunningRank(right.element.id)
            if leftRank != rightRank {
                return leftRank < rightRank
            }

            let leftDate = store.statusMonitor.lastActivityDate(for: left.element.id)
            let rightDate = store.statusMonitor.lastActivityDate(for: right.element.id)
            if leftDate != rightDate {
                return (leftDate ?? .distantPast) > (rightDate ?? .distantPast)
            }

            return left.offset < right.offset
        }
        .map(\.element)
    }

    private func workspaceRunningRank(_ workspaceId: String) -> Int {
        if store.statusMonitor.isStreaming(workspaceId) { return 0 }
        return 1
    }

    private func handleCreateWorkspace(for projectId: String) {
        Task {
            await store.createWorkspace(in: projectId)
        }
    }

    // MARK: - Matching

    private func projectMatches(_ project: Project, query: String) -> Bool {
        let displayName = HubProjectDisplay.name(for: project).plain
        return project.name.localizedCaseInsensitiveContains(query)
            || displayName.localizedCaseInsensitiveContains(query)
            || (project.url?.localizedCaseInsensitiveContains(query) ?? false)
    }

    private func workspaceMatches(_ workspace: Workspace, query: String) -> Bool {
        workspace.name.localizedCaseInsensitiveContains(query)
            || workspace.branch.localizedCaseInsensitiveContains(query)
    }

    // MARK: - Activity

    private func activitySummary(for section: HubSection) -> HubActivitySummary {
        section.projects.reduce(HubActivitySummary()) { partial, node in
            var next = partial
            let projectActivity = activitySummary(for: node.project)
            next.streaming += projectActivity.streaming
            next.completed += projectActivity.completed
            next.needsAttention += projectActivity.needsAttention
            return next
        }
    }

    private func activitySummary(for project: Project) -> HubActivitySummary {
        project.workspaces.reduce(HubActivitySummary()) { partial, workspace in
            var next = partial
            if store.statusMonitor.isStreaming(workspace.id) {
                next.streaming += 1
            }
            if store.statusMonitor.isCompleted(workspace.id) {
                next.completed += 1
            }
            if workspaceNeedsAttention(workspace.id) {
                next.needsAttention += 1
            }
            return next
        }
    }

    private func workspaceNeedsAttention(_ workspaceId: String) -> Bool {
        guard let pr = store.statusMonitor.prStatus(for: workspaceId)?.pr else { return false }
        return HubPrStatusRules.needsAttention(pr)
    }

    private func projectHasLiveAttention(_ project: Project) -> Bool {
        let activity = activitySummary(for: project)
        return activity.streaming > 0 || activity.completed > 0 || activity.needsAttention > 0
    }

    // MARK: - Expansion State

    private func isSectionExpanded(_ section: HubSection) -> Bool {
        if !normalizedSearch.isEmpty { return true }
        return sectionExpansionOverrides[section.id] ?? section.defaultExpanded
    }

    private func isProjectExpanded(_ project: Project) -> Bool {
        if !normalizedSearch.isEmpty { return true }
        return projectExpansionOverrides[project.id] ?? projectHasLiveAttention(project)
    }

    private func setSection(_ section: HubSection, expanded: Bool) {
        withAnimation(.easeInOut(duration: 0.2)) {
            sectionExpansionOverrides[section.id] = expanded
        }
        saveExpansionOverrides(sectionExpansionOverrides, key: Self.sectionExpansionKey)
    }

    private func setProject(_ projectId: String, expanded: Bool) {
        withAnimation(.easeInOut(duration: 0.2)) {
            projectExpansionOverrides[projectId] = expanded
        }
        saveExpansionOverrides(projectExpansionOverrides, key: Self.projectExpansionKey)
    }

    private static let sectionExpansionKey = "hub_section_expansion_overrides"
    private static let projectExpansionKey = "hub_project_expansion_overrides"

    private static func loadExpansionOverrides(key: String) -> [String: Bool] {
        guard let data = UserDefaults.standard.data(forKey: key),
              let value = try? JSONDecoder().decode([String: Bool].self, from: data) else {
            return [:]
        }
        return value
    }

    private func saveExpansionOverrides(_ value: [String: Bool], key: String) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }

    // MARK: - Error Banner

    private func errorBanner(_ message: String) -> some View {
        VStack {
            Spacer()
            Text(message)
                .font(.footnote)
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(.red.opacity(0.85), in: Capsule())
                .padding(.bottom, 8)
        }
        .transition(.move(edge: .bottom))
        .animation(.default, value: store.errorMessage)
    }
}

#Preview {
    NavigationStack {
        HubView()
    }
    .environment(ProjectStore(storeCache: ConversationStoreCache()))
    .preferredColorScheme(.dark)
}
