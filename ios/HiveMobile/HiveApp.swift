import SwiftUI

@main
struct HiveApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @State private var storeCache: ConversationStoreCache
    @State private var projectStore: ProjectStore
    @State private var modelCatalog = ModelCatalog()
    @State private var selectedTab: AppTab = .hub
    @State private var hubPath = NavigationPath()
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("hiveAccent") private var accentId = "violet"

    private let liveActivityManager = LiveActivityManager()

    init() {
        let cache = ConversationStoreCache()
        _storeCache = State(initialValue: cache)
        _projectStore = State(initialValue: ProjectStore(storeCache: cache))
    }

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
                                ChatView(
                                    workspace: workspace,
                                    store: storeCache.getOrCreate(workspace.id)
                                )
                                .toolbar(.hidden, for: .tabBar)
                                .smoothTabBarTransition()
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
            .environment(storeCache)
            .environment(modelCatalog)
            .preferredColorScheme(.dark)
            .task { await modelCatalog.loadIfNeeded() }
            .onChange(of: scenePhase) { _, phase in
                handleScenePhase(phase)
            }
            .onChange(of: projectStore.pendingNavigation) { _, workspace in
                guard let workspace else { return }
                selectedTab = .hub
                hubPath.append(workspace)
                projectStore.pendingNavigation = nil
            }
            .onAppear {
                setupStreamingCallback()
                mergePushCompletions()
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

    /// Merge workspace IDs delivered via push notification taps into the hub status monitor.
    private func mergePushCompletions() {
        let store = CompletedWorkspacesStore.shared
        for wsId in store.pending {
            projectStore.statusMonitor.markCompletedFromPush(wsId)
        }
        store.clearAll()
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
