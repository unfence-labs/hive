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
    @State private var showOnboarding = (UserDefaults.standard.string(forKey: "serverHost") ?? "")
        .trimmingCharacters(in: .whitespaces).isEmpty
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

    /// Tab switches must be instant: the iOS 26 TabView cross-dissolve blends
    /// both tabs' content mid-transition, which reads as a UI flash. The fade
    /// runs inside UIKit's tab controller, so SwiftUI transactions can't
    /// disable it — UIKit animations are suspended for the switch instead.
    private var tabSelection: Binding<AppTab> {
        Binding(
            get: { selectedTab },
            set: { switchTab(to: $0) }
        )
    }

    private func switchTab(to tab: AppTab) {
        guard tab != selectedTab else { return }
        UIView.setAnimationsEnabled(false)
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) { selectedTab = tab }
        DispatchQueue.main.async { UIView.setAnimationsEnabled(true) }
    }

    var body: some Scene {
        WindowGroup {
            TabView(selection: tabSelection) {
                Tab("Brain", systemImage: "brain", value: .brain) {
                    NavigationStack(path: $brainPath) {
                        BrainConversationsView(
                            store: storeCache.getOrCreate(BRAIN_WORKSPACE_ID),
                            navigationPath: $brainPath
                        )
                    }
                    .hiveScreenBackground()
                    .toolbar(brainPath.isEmpty ? .automatic : .hidden, for: .tabBar)
                }
                Tab("Hub", systemImage: "square.grid.2x2.fill", value: .hub) {
                    NavigationStack(path: $hubPath) {
                        HubView(openSettings: { switchTab(to: .settings) })
                            .navigationDestination(for: Workspace.self) { workspace in
                                WorkspaceConversationsView(
                                    workspace: workspace,
                                    store: storeCache.getOrCreate(workspace.id),
                                    navigationPath: $hubPath
                                )
                            }
                    }
                    .hiveScreenBackground()
                    .toolbar(hubPath.isEmpty ? .automatic : .hidden, for: .tabBar)
                }
                .badge(projectStore.statusMonitor.hubBadgeCount)
                Tab("Settings", systemImage: "gearshape.fill", value: .settings) {
                    NavigationStack {
                        SettingsView()
                    }
                    .hiveScreenBackground()
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
            .overlay {
                if showOnboarding {
                    OnboardingView(onDone: {
                        withAnimation { showOnboarding = false }
                        Task { await projectStore.refresh(force: true) }
                    })
                    .background(WhisperColor.appBackground)
                    .transition(.opacity)
                }
            }
            .preferredColorScheme(themeMode.preferredColorScheme)
            .task { await modelCatalog.loadIfNeeded() }
            .onChange(of: projectStore.pendingNavigation) { _, workspace in
                guard let workspace else { return }
                switchTab(to: .hub)
                // Deferred one tick so navigation animates after UIKit animations re-enable.
                DispatchQueue.main.async { hubPath.append(workspace) }
                projectStore.pendingNavigation = nil
            }
            .onChange(of: scenePhase) { _, newPhase in
                switch newPhase {
                case .background:
                    backgroundedAt = Date()
                case .active:
                    if let bg = backgroundedAt {
                        let elapsed = Date().timeIntervalSince(bg)
                        projectStore.statusMonitor.appDidBecomeActive()
                        Task { await modelCatalog.load() }
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
}

enum AppTab: Hashable {
    case brain, hub, settings
}
