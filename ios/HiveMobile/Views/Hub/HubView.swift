import SwiftUI

struct HubView: View {
    @Environment(ProjectStore.self) private var store
    @State private var showAddProject = false
    @State private var workspaceToArchive: Workspace?
    @State private var collapsedProjectIds: Set<String> = HubView.loadCollapsedIds()

    private let columns = [GridItem(.flexible()), GridItem(.flexible())]

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
            } else {
                projectGrid
            }
        }
        .scrollBounceBehavior(.always)
        .navigationTitle("Hub")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbarContent }
        .refreshable {
            // Unstructured Task shields refresh from SwiftUI prematurely
            // cancelling the .refreshable task on ScrollView (known iOS 26 regression).
            await Task { @MainActor in
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
            AddProjectSheet { url in
                Task { await store.createProject(url: url) }
            }
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

    // MARK: - Project Grid

    private var projectGrid: some View {
        LazyVStack(alignment: .leading, spacing: HiveSpacing.lg) {
            ForEach(store.projects) { project in
                projectSection(project)
            }
        }
        .padding()
    }

    private func projectSection(_ project: Project) -> some View {
        let isCollapsible = !project.workspaces.isEmpty
        let isCollapsed = isCollapsible && collapsedProjectIds.contains(project.id)

        return VStack(alignment: .leading, spacing: HiveSpacing.md) {
            projectSectionHeader(project, isCollapsed: isCollapsed, isCollapsible: isCollapsible)

            if !isCollapsed {
                if project.workspaces.isEmpty {
                    Text("No active workspaces")
                        .font(.subheadline)
                        .foregroundStyle(.tertiary)
                } else {
                    LazyVGrid(columns: columns, spacing: HiveSpacing.md) {
                        ForEach(project.workspaces) { workspace in
                            NavigationLink(value: workspace) {
                                WorkspaceCard(
                                    workspace: workspace,
                                    isStreaming: store.statusMonitor.isStreaming(workspace.id),
                                    diffStats: store.statusMonitor.diffStats(for: workspace.id),
                                    branchInfo: store.statusMonitor.branchInfo(for: workspace.id),
                                    sessionCount: workspace.sessionCount
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
                }
            }
        }
        .clipped()
    }

    private func projectSectionHeader(_ project: Project, isCollapsed: Bool, isCollapsible: Bool) -> some View {
        let hasStreaming = projectHasStreaming(project)

        return HStack(spacing: HiveSpacing.sm) {
            ProjectAvatar(project: project)
            projectTitle(project)

            Spacer(minLength: 0)

            if isCollapsed {
                Text("\(project.workspaces.count)")
                    .font(.caption2.weight(.medium).monospacedDigit())
                    .foregroundStyle(hasStreaming ? .white : .secondary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.white.opacity(0.08), in: Capsule())

                if hasStreaming {
                    AgentActivityIndicator(dotSize: 2.5, spacing: 1)
                } else {
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }
            } else {
                addWorkspaceButton(for: project)
            }
        }
        .padding(.horizontal, HiveSpacing.md)
        .frame(minHeight: 44)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(.white.opacity(0.06))
                .stroke(.white.opacity(0.08), lineWidth: 0.5)
        )
        .contentShape(Rectangle())
        .onTapGesture {
            guard isCollapsible else { return }
            toggleCollapse(project.id)
        }
    }

    private func addWorkspaceButton(for project: Project) -> some View {
        let isCreating = store.creatingWorkspaceProjectIds.contains(project.id)
        return Button {
            handleCreateWorkspace(for: project.id)
        } label: {
            Group {
                if isCreating {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Image(systemName: "plus")
                        .font(.footnote.weight(.semibold))
                }
            }
            .frame(width: 28, height: 28)
            .background(.white.opacity(0.08), in: Circle())
        }
        .buttonStyle(.plain)
        .disabled(isCreating)
        .accessibilityLabel(isCreating ? "Creating workspace for \(project.name)" : "Add workspace to \(project.name)")
        .accessibilityHint("Creates a new workspace in this project.")
    }

    private func handleCreateWorkspace(for projectId: String) {
        Task {
            await store.createWorkspace(in: projectId)
        }
    }

    // MARK: - Collapse State

    private func toggleCollapse(_ projectId: String) {
        withAnimation(.easeInOut(duration: 0.25)) {
            if collapsedProjectIds.contains(projectId) {
                collapsedProjectIds.remove(projectId)
            } else {
                collapsedProjectIds.insert(projectId)
            }
        }
        saveCollapsedIds()
    }

    private func projectHasStreaming(_ project: Project) -> Bool {
        project.workspaces.contains { store.statusMonitor.isStreaming($0.id) }
    }

    private static let collapsedKey = "hub_collapsed_projects"

    private static func loadCollapsedIds() -> Set<String> {
        guard let data = UserDefaults.standard.data(forKey: collapsedKey),
              let ids = try? JSONDecoder().decode(Set<String>.self, from: data) else {
            return []
        }
        return ids
    }

    private func saveCollapsedIds() {
        guard let data = try? JSONEncoder().encode(collapsedProjectIds) else { return }
        UserDefaults.standard.set(data, forKey: Self.collapsedKey)
    }

    // MARK: - Project Title

    @ViewBuilder
    private func projectTitle(_ project: Project) -> some View {
        if let parts = ownerAndRepo(from: project.url) ?? ownerAndRepo(from: project.name) {
            Text("\(Text("\(parts.owner)/").foregroundStyle(.secondary))\(Text(parts.repo).foregroundStyle(.white))")
                .font(.headline)
        } else {
            Text(project.name)
                .font(.headline)
                .foregroundStyle(.white)
        }
    }

    private func ownerAndRepo(from rawInput: String) -> (owner: String, repo: String)? {
        let trimmed = rawInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        let noTrailingSlash = trimmed.hasSuffix("/") ? String(trimmed.dropLast()) : trimmed
        let noGitSuffix = noTrailingSlash.hasSuffix(".git") ? String(noTrailingSlash.dropLast(4)) : noTrailingSlash

        // HTTP(S)/SSH URLs with scheme.
        if let url = URL(string: noGitSuffix), url.scheme != nil {
            let pathParts = url.pathComponents.filter { $0 != "/" && !$0.isEmpty }
            if pathParts.count >= 2 {
                return (pathParts[pathParts.count - 2], pathParts[pathParts.count - 1])
            }
        }

        // SCP-like SSH or plain "host/org/repo" inputs.
        let normalized = noGitSuffix.replacingOccurrences(of: ":", with: "/")
        let parts = normalized.split(separator: "/").map(String.init)
        guard parts.count >= 2 else { return nil }

        let repo = parts[parts.count - 1]
        let owner = parts[parts.count - 2]
        if owner.contains("@") || owner.contains(".") || repo.isEmpty {
            return nil
        }
        return (owner, repo)
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
    .environment(ProjectStore())
    .preferredColorScheme(.dark)
}
