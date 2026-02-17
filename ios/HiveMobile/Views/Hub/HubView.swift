import SwiftUI

struct HubView: View {
    @State private var projects: [Project] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    private let api = APIClient()

    var body: some View {
        NavigationStack {
            ScrollView {
                if isLoading && projects.isEmpty {
                    ProgressView()
                        .padding(.top, 80)
                } else if projects.isEmpty {
                    ContentUnavailableView(
                        "No Projects",
                        systemImage: "folder",
                        description: Text("Connect to your Hive server in Settings.")
                    )
                    .padding(.top, 40)
                } else {
                    projectList
                }
            }
            .navigationTitle("Hub")
            .navigationDestination(for: Workspace.self) { workspace in
                ChatView(workspace: workspace)
            }
            .refreshable { await loadProjects() }
            .task { await loadProjects() }
            .overlay {
                if let errorMessage {
                    errorBanner(errorMessage)
                }
            }
        }
    }

    // MARK: - Project list

    private var projectList: some View {
        LazyVStack(alignment: .leading, spacing: 28) {
            ForEach(projects) { project in
                projectSection(project)
            }
        }
        .padding()
    }

    private func projectSection(_ project: Project) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(project.name)
                .font(.headline)
                .foregroundStyle(.secondary)

            if project.workspaces.isEmpty {
                Text("No active workspaces")
                    .font(.subheadline)
                    .foregroundStyle(.tertiary)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 12) {
                        ForEach(project.workspaces) { workspace in
                            NavigationLink(value: workspace) {
                                WorkspaceCard(workspace: workspace)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Error banner

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
        .animation(.default, value: errorMessage)
    }

    // MARK: - Data loading

    private func loadProjects() async {
        isLoading = true
        errorMessage = nil
        do {
            projects = try await api.fetchProjects()
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

#Preview {
    HubView()
        .preferredColorScheme(.dark)
}
