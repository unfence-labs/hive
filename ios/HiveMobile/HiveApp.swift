import SwiftUI

@main
struct HiveApp: App {
    @State private var projectStore = ProjectStore()
    @State private var selectedTab: AppTab = .hub
    @State private var hubPath = NavigationPath()
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("hiveAccent") private var accentId = "violet"

    private let liveActivityManager = LiveActivityManager()

    private var accent: Color {
        AccentOption(rawValue: accentId)?.color ?? AccentOption.violet.color
    }

    var body: some Scene {
        WindowGroup {
            TabView(selection: $selectedTab) {
                Tab("Hub", systemImage: "square.grid.2x2.fill", value: .hub) {
                    NavigationStack(path: $hubPath) {
                        HubView()
                            .navigationDestination(for: Workspace.self) { workspace in
                                ChatView(workspace: workspace)
                                    .toolbar(.hidden, for: .tabBar)
                            }
                    }
                    .toolbarColorScheme(.dark, for: .navigationBar)
                }
                Tab("Settings", systemImage: "gearshape.fill", value: .settings) {
                    NavigationStack {
                        SettingsView()
                    }
                    .tint(.white)
                }
            }
            .tint(accent)
            .environment(projectStore)
            .preferredColorScheme(.dark)
            .onChange(of: scenePhase) { _, phase in
                handleScenePhase(phase)
            }
            .onAppear {
                setupStreamingCallback()
            }
        }
    }

    private func handleScenePhase(_ phase: ScenePhase) {
        switch phase {
        case .background:
            liveActivityManager.didEnterBackground(
                streamingIds: projectStore.statusMonitor.streamingWorkspaces,
                labelResolver: workspaceLabel(for:)
            )
        case .active:
            liveActivityManager.didEnterForeground()
        default:
            break
        }
    }

    private func setupStreamingCallback() {
        projectStore.statusMonitor.onStreamingChange = { [liveActivityManager] ids in
            liveActivityManager.streamingDidChange(
                streamingIds: ids,
                labelResolver: workspaceLabel(for:)
            )
        }
    }

    private func workspaceLabel(for id: String) -> WorkspaceLabel? {
        for project in projectStore.projects {
            if let ws = project.workspaces.first(where: { $0.id == id }) {
                return WorkspaceLabel(project: project.name, branch: ws.branch)
            }
        }
        return nil
    }
}

enum AppTab: Hashable {
    case hub, settings
}
