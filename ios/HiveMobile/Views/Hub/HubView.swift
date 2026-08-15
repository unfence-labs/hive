import SwiftUI

private enum HubLayout {
    static let projectIndent: CGFloat = 16
    static let workspaceIndent: CGFloat = 16
    static let hierarchyLineInset: CGFloat = 5
    static let projectIconCenterX: CGFloat = 10
}

struct HubView: View {
    @Environment(ProjectStore.self) private var store
    @Binding var navigationPath: NavigationPath
    var openSettings: (() -> Void)?
    @State private var showAddProject = false
    @State private var workspaceToArchive: Workspace?
    @State private var sectionExpansionOverrides: [String: Bool] = HubView.loadExpansionOverrides(
        key: HubView.sectionExpansionKey
    )
    @State private var projectExpansionOverrides: [String: Bool] = HubView.loadExpansionOverrides(
        key: HubView.projectExpansionKey
    )
    @State private var sections: [HubSection] = []
    @State private var searchText = ""

    var body: some View {
        let displayedSections = filteredSections(sections)
        let prIds = visiblePrWorkspaceIds(in: displayedSections)

        ZStack {
            WhisperColor.appBackground
                .ignoresSafeArea()

            List {
                Group {
                    if store.projects.isEmpty {
                        emptyState
                    } else if !searchText.isEmpty, displayedSections.isEmpty {
                        ContentUnavailableView.search(text: searchText)
                            .padding(.top, 40)
                    } else {
                        ForEach(displayedSections) { section in
                            sectionView(section)
                        }
                    }
                }
                .listRowInsets(EdgeInsets(
                    top: HiveSpacing.md,
                    leading: HiveSpacing.lg,
                    bottom: 0,
                    trailing: HiveSpacing.lg
                ))
                .listRowBackground(WhisperColor.appBackground)
                .listRowSeparator(.hidden)
            }
            .listStyle(.plain)
            .scrollBounceBehavior(.always)
            .scrollContentBackground(.hidden)
            .searchable(text: $searchText, placement: .navigationBarDrawer(displayMode: .always))
            .refreshable {
                // Unstructured Task shields refresh from SwiftUI prematurely
                // cancelling the .refreshable task on ScrollView (known iOS 26 regression).
                await Task { @MainActor in
                    store.statusMonitor.forceRefresh()
                    await store.refresh(force: true, userInitiated: true)
                }.value
            }
        }
        .navigationTitle("Hub")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbarContent }
        .task {
            // Always safe: existing data stays visible while refresh runs.
            await store.refresh()
        }
        .onAppear {
            store.statusMonitor.returnToHub(visiblePrWorkspaces: prIds)
        }
        .onDisappear {
            store.statusMonitor.syncVisiblePrWorkspaces([])
        }
        .task(id: prIds) {
            store.statusMonitor.syncVisiblePrWorkspaces(prIds)
        }
        .onChange(of: store.projects, initial: true) { _, _ in sections = baseSections }
        .onChange(of: store.uiPreferences.sidebar) { _, _ in sections = baseSections }
        .overlay {
            if let errorMessage = store.errorMessage {
                errorBanner(errorMessage)
            }
        }
        .overlay(alignment: .top) {
            if store.refreshFailedWithCachedData {
                refreshFailedNotice
                    .task {
                        try? await Task.sleep(for: .seconds(3))
                        if !Task.isCancelled {
                            store.acknowledgeRefreshFailure()
                        }
                    }
            } else if store.archiveFailed {
                archiveFailedNotice
                    .task {
                        try? await Task.sleep(for: .seconds(3))
                        if !Task.isCancelled {
                            store.acknowledgeArchiveFailure()
                        }
                    }
            }
        }
        .animation(.default, value: store.refreshFailedWithCachedData)
        .animation(.default, value: store.archiveFailed)
        .onChange(of: store.archiveFailed) { _, failed in
            if failed {
                Haptics.notify(.error)
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if let repoName = store.cloningRepoName {
                HStack(spacing: HiveSpacing.sm) {
                    ProgressView()
                        .controlSize(.small)
                    Text("Cloning \(repoName)...")
                        .font(.footnote)
                        .foregroundStyle(WhisperColor.textSecondary)
                }
                .padding(.horizontal, HiveSpacing.lg)
                .padding(.vertical, HiveSpacing.sm)
                .glassPill()
                .padding(.vertical, HiveSpacing.sm)
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.default, value: store.cloningRepoName != nil)
        .sheet(isPresented: $showAddProject) {
            AddProjectSheet(
                api: APIClient(),
                onClone: { url in await store.createProject(url: url) },
                onCreate: { name, visibility in await store.createNewProject(name: name, visibility: visibility) }
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
            Text("\"\(ws.name)\" will be archived and removed from this list. Any uncommitted changes will be lost.")
        }
    }

    private var loadingState: some View {
        ListLoadingSkeleton()
            .frame(maxWidth: .infinity, minHeight: 420)
            .frame(maxHeight: .infinity)
    }

    @ViewBuilder
    private var emptyState: some View {
        if let failure = store.fetchFailure {
            HubUnreachableState(
                failure: failure,
                isRetrying: store.isLoading,
                onRetry: { Task { await store.refresh(force: true) } },
                onOpenSettings: { openSettings?() }
            )
        } else if store.isLoading || !store.hasLoadedSuccessfully {
            loadingState
        } else {
            ContentUnavailableView {
                Label("No Projects", systemImage: "folder")
            } description: {
                Text("Tap + to add your first project, or connect to your Hive server from Settings.")
            } actions: {
                Button("Add project") { showAddProject = true }
                    .buttonStyle(.borderedProminent)
                Button("Open Settings") { openSettings?() }
                    .buttonStyle(.bordered)
            }
            .padding(.top, 40)
        }
    }

    private var refreshFailedNotice: some View {
        transientNotice(icon: "exclamationmark.triangle", message: "Couldn't refresh. Showing cached data.")
    }

    private var archiveFailedNotice: some View {
        transientNotice(icon: "exclamationmark.triangle", message: "Failed to archive workspace")
    }

    private func transientNotice(icon: String, message: String) -> some View {
        HStack(spacing: HiveSpacing.sm) {
            Image(systemName: icon)
            Text(message)
                .font(.footnote)
        }
        .foregroundStyle(WhisperColor.textSecondary)
        .padding(.horizontal, HiveSpacing.lg)
        .padding(.vertical, HiveSpacing.sm)
        .glassPill()
        .padding(.top, HiveSpacing.sm)
        .transition(.move(edge: .top).combined(with: .opacity))
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            ToolbarAddButton(
                isLoading: store.isCreatingProject,
                accessibilityLabel: "Add project",
                accessibilityHint: "Opens the add project sheet."
            ) {
                showAddProject = true
            }
            .disabled(store.isCreatingProject)
        }
    }

    // MARK: - Dense Hub

    private var baseSections: [HubSection] {
        HubOrganization.sections(
            projects: store.projects,
            preferences: store.uiPreferences.sidebar
        )
    }

    private func filteredSections(_ sections: [HubSection]) -> [HubSection] {
        guard !searchText.isEmpty else { return sections }
        return sections.compactMap { section in
            let nodes = section.projects.compactMap { node -> HubProjectNode? in
                let projectMatches = node.project.name.localizedCaseInsensitiveContains(searchText)
                let workspaces = node.project.workspaces.filter {
                    $0.name.localizedCaseInsensitiveContains(searchText)
                        || $0.branch.localizedCaseInsensitiveContains(searchText)
                }
                if projectMatches { return node }
                guard !workspaces.isEmpty else { return nil }
                var project = node.project
                project.workspaces = workspaces
                return HubProjectNode(project: project)
            }
            guard !nodes.isEmpty else { return nil }
            return HubSection(kind: section.kind, projects: nodes, defaultExpanded: true)
        }
    }

    private func visiblePrWorkspaceIds(in sections: [HubSection]) -> [String] {
        var ids: [String] = []
        for section in sections where isSectionExpanded(section) {
            for node in section.projects where isProjectExpanded(node.project) {
                ids.append(contentsOf: node.project.workspaces.map(\.id))
            }
        }
        return ids
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
                .hubHierarchyGuide(indent: HubLayout.projectIndent)
                .transition(.opacity)
            }
        }
    }

    private func projectView(_ project: Project) -> some View {
        let expanded = isProjectExpanded(project)

        return VStack(alignment: .leading, spacing: HiveSpacing.xs) {
            HubProjectRow(
                project: project,
                activity: activitySummary(for: project),
                isCreatingWorkspace: store.creatingWorkspaceProjectIds.contains(project.id),
                onToggle: { setProject(project.id, expanded: !expanded) },
                onAddWorkspace: { handleCreateWorkspace(for: project.id) }
            )

            if expanded {
                projectWorkspaceContent(project)
                    .transition(.opacity)
            }
        }
    }

    @ViewBuilder
    private func projectWorkspaceContent(_ project: Project) -> some View {
        if project.workspaces.isEmpty {
            Text("No active workspaces")
                .font(.caption)
                .foregroundStyle(WhisperColor.textMuted)
                .padding(.vertical, HiveSpacing.xs)
                .hubHierarchyGuide(
                    indent: HubLayout.workspaceIndent,
                    lineInset: HubLayout.projectIconCenterX
                )
        } else {
            VStack(spacing: HiveSpacing.xs) {
                ForEach(sortedWorkspaces(project.workspaces)) { workspace in
                    // NavigationLinks nested in this shared List row activate together.
                    Button {
                        navigationPath.append(workspace)
                    } label: {
                        HStack(spacing: HiveSpacing.xs) {
                            HubWorkspaceRow(
                                workspace: workspace,
                                monitor: store.statusMonitor
                            )
                            Image(systemName: "chevron.right")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(WhisperColor.textMuted)
                                .accessibilityHidden(true)
                        }
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
            .hubHierarchyGuide(
                indent: HubLayout.workspaceIndent,
                lineInset: HubLayout.projectIconCenterX
            )
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
        if store.statusMonitor.hasUnreadSessions(workspaceId) { return 1 }
        return 2
    }

    private func handleCreateWorkspace(for projectId: String) {
        Task {
            await store.createWorkspace(in: projectId)
        }
    }

    // MARK: - Activity

    private func activitySummary(for section: HubSection) -> HubActivitySummary {
        section.projects.reduce(HubActivitySummary()) { partial, node in
            var next = partial
            let projectActivity = activitySummary(for: node.project)
            next.streaming += projectActivity.streaming
            next.unread += projectActivity.unread
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
            if store.statusMonitor.hasUnreadSessions(workspace.id) {
                next.unread += 1
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
        return activity.streaming > 0 || activity.unread > 0 || activity.needsAttention > 0
    }

    // MARK: - Expansion State

    private func isSectionExpanded(_ section: HubSection) -> Bool {
        return !searchText.isEmpty || (sectionExpansionOverrides[section.id] ?? section.defaultExpanded)
    }

    private func isProjectExpanded(_ project: Project) -> Bool {
        return !searchText.isEmpty || (projectExpansionOverrides[project.id] ?? projectHasLiveAttention(project))
    }

    private func setSection(_ section: HubSection, expanded: Bool) {
        guard searchText.isEmpty else { return }
        withAnimation(.easeInOut(duration: 0.2)) {
            sectionExpansionOverrides[section.id] = expanded
        }
        saveExpansionOverrides(sectionExpansionOverrides, key: Self.sectionExpansionKey)
    }

    private func setProject(_ projectId: String, expanded: Bool) {
        guard searchText.isEmpty else { return }
        withAnimation(.easeInOut(duration: 0.2)) {
            projectExpansionOverrides[projectId] = expanded
        }
        saveExpansionOverrides(projectExpansionOverrides, key: Self.projectExpansionKey)
    }

    private static let sectionExpansionKey = "hub_section_expansion_overrides"
    private static let projectExpansionKey = "hub_project_expansion_overrides"

    static func clearExpansionOverrides() {
        UserDefaults.standard.removeObject(forKey: sectionExpansionKey)
        UserDefaults.standard.removeObject(forKey: projectExpansionKey)
    }

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

private struct HubUnreachableState: View {
    let failure: ProjectStore.FetchFailure
    let isRetrying: Bool
    let onRetry: () -> Void
    let onOpenSettings: () -> Void

    var body: some View {
        VStack(spacing: HiveSpacing.md) {
            Image(systemName: icon)
                .font(.system(size: 44))
                .foregroundStyle(WhisperColor.textMuted)
            Text(title)
                .font(.title3.weight(.semibold))
                .foregroundStyle(WhisperColor.text)
                .multilineTextAlignment(.center)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(WhisperColor.textSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            VStack(spacing: HiveSpacing.sm) {
                Button(action: onRetry) {
                    HStack(spacing: HiveSpacing.sm) {
                        if isRetrying {
                            ProgressView()
                                .controlSize(.small)
                        }
                        Text(isRetrying ? "Retrying..." : "Retry")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(isRetrying)

                Button("Open Settings", action: onOpenSettings)
                    .buttonStyle(.bordered)
                    .disabled(isRetrying)
            }
            .padding(.top, HiveSpacing.sm)
        }
        .padding(HiveSpacing.xl)
        .frame(maxWidth: .infinity)
        .padding(.top, 40)
    }

    private var icon: String {
        switch failure {
        case .unreachable: "wifi.slash"
        case .authentication: "lock.trianglebadge.exclamationmark"
        case .other: "exclamationmark.triangle"
        }
    }

    private var title: String {
        switch failure {
        case .unreachable: "Can't reach your Hive server"
        case .authentication: "Can't sign in to your Hive server"
        case .other: "Something went wrong"
        }
    }

    private var message: String {
        switch failure {
        case .unreachable:
            "Hive couldn't connect to your server. Check that it's running and reachable, then try again."
        case .authentication:
            "Your Hive server rejected the current credentials. Open Settings to check your server address and token."
        case .other:
            "Your Hive server returned an unexpected error. Try again in a moment."
        }
    }
}

private extension View {
    func hubHierarchyGuide(indent: CGFloat, lineInset: CGFloat = HubLayout.hierarchyLineInset) -> some View {
        padding(.leading, indent)
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(WhisperColor.hubStructure)
                    .frame(width: 1)
                    .padding(.leading, lineInset)
            }
    }
}

#Preview {
    NavigationStack {
        HubView(navigationPath: .constant(NavigationPath()))
    }
    .environment(ProjectStore(storeCache: ConversationStoreCache()))
    .preferredColorScheme(.dark)
}
