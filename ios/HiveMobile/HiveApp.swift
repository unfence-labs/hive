import SwiftUI

@main
struct HiveApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    @State private var storeCache: ConversationStoreCache
    @State private var projectStore: ProjectStore
    @State private var modelCatalog = ModelCatalog()
    @State private var selectedTab: AppTab = .hub
    @State private var hubPath = NavigationPath()
    @State private var brainPath = NavigationPath()
    @State private var backgroundedAt: Date?
    @AppStorage("hiveAccent") private var accentId = AccentOption.defaultId
    @AppStorage("hiveThemeMode") private var themeModeId = HiveThemeMode.system.rawValue

    init() {
        let cache = ConversationStoreCache()
        _storeCache = State(initialValue: cache)
        _projectStore = State(initialValue: ProjectStore(storeCache: cache))
    }

    private var accent: Color {
        AccentOption(rawValue: accentId)?.color ?? AccentOption.violet.color
    }

    private var themeMode: HiveThemeMode {
        HiveThemeMode(rawValue: themeModeId) ?? .system
    }

    var body: some Scene {
        WindowGroup {
            TabView(selection: $selectedTab) {
                Tab("Brain", systemImage: "brain", value: .brain) {
                    NavigationStack(path: $brainPath) {
                        BrainConversationsView(
                            store: storeCache.getOrCreate(BRAIN_WORKSPACE_ID),
                            navigationPath: $brainPath
                        )
                    }
                }
                Tab("Hub", systemImage: "square.grid.2x2.fill", value: .hub) {
                    NavigationStack(path: $hubPath) {
                        HubView()
                            .navigationDestination(for: Workspace.self) { workspace in
                                WorkspaceConversationsView(
                                    workspace: workspace,
                                    store: storeCache.getOrCreate(workspace.id),
                                    navigationPath: $hubPath
                                )
                                .toolbar(.hidden, for: .tabBar)
                            }
                    }
                }
                Tab("Settings", systemImage: "gearshape.fill", value: .settings) {
                    NavigationStack {
                        SettingsView()
                    }
                }
            }
            .hiveScreenBackground()
            .tint(accent)
            .safeAreaInset(edge: .top, spacing: 0) {
                ConnectionBanner(monitor: projectStore.statusMonitor)
            }
            .environment(projectStore)
            .environment(storeCache)
            .environment(modelCatalog)
            .preferredColorScheme(themeMode.preferredColorScheme)
            .task { await modelCatalog.loadIfNeeded() }
            .onChange(of: projectStore.pendingNavigation) { _, workspace in
                guard let workspace else { return }
                selectedTab = .hub
                hubPath.append(workspace)
                projectStore.pendingNavigation = nil
            }
            .onAppear {
                mergePushCompletions()
            }
            .onChange(of: CompletedWorkspacesStore.shared.pending) { _, pending in
                guard !pending.isEmpty else { return }
                mergePushCompletions()
            }
            .onChange(of: scenePhase) { _, newPhase in
                switch newPhase {
                case .background:
                    backgroundedAt = Date()
                case .active:
                    if let bg = backgroundedAt {
                        let elapsed = Date().timeIntervalSince(bg)
                        projectStore.statusMonitor.appDidBecomeActive()
                        if elapsed > 30 {
                            Task { await projectStore.refresh(force: true) }
                        }
                    }
                    backgroundedAt = nil
                default:
                    break
                }
            }
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
}

enum AppTab: Hashable {
    case brain, hub, settings
}
