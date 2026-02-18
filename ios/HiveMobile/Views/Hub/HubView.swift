import SwiftUI

struct HubView: View {
    @Environment(ProjectStore.self) private var store

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
                    description: Text("Connect to your Hive server from the Settings tab below.")
                )
                .padding(.top, 40)
            } else {
                projectGrid
            }
        }
        .scrollBounceBehavior(.always)
        .toolbar(.hidden, for: .navigationBar)
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
    }

    // MARK: - Project Grid

    private var projectGrid: some View {
        LazyVStack(alignment: .leading, spacing: HiveSpacing.xxl) {
            ForEach(store.projects) { project in
                projectSection(project)
            }
        }
        .padding()
    }

    private func projectSection(_ project: Project) -> some View {
        VStack(alignment: .leading, spacing: HiveSpacing.md) {
            HStack(spacing: 8) {
                ProjectAvatar(project: project)
                Text(project.name)
                    .font(.headline)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
                addWorkspaceButton(for: project)
            }

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
                        .contentShape(Rectangle())
                        .buttonStyle(.plain)
                    }
                }
            }
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
