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
    @State private var backgroundedAt: Date?
    @AppStorage("hiveAccent") private var accentId = "violet"

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
                    if let bg = backgroundedAt, Date().timeIntervalSince(bg) > 2 {
                        projectStore.statusMonitor.appDidBecomeActive()
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
    case hub, settings
}
