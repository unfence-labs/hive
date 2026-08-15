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
    @State private var hasServerConnection = ServerConnectionStore.shared.hasConfiguration
    @State private var serverGeneration = 0
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
            ZStack {
                if hasServerConnection {
                    mainApp.id(serverGeneration)
                }
                if !hasServerConnection {
                    OnboardingView(onConnect: establishConnection, onComplete: completeOnboarding)
                        .zIndex(1)
                        .transition(.asymmetric(
                            insertion: .identity,
                            removal: .opacity.combined(with: .scale(scale: 0.96))
                        ))
                }
            }
            .preferredColorScheme(themeMode.preferredColorScheme)
            .onChange(of: scenePhase) { _, newPhase in
                guard newPhase == .active, !hasServerConnection else { return }
                // A launch while the device was locked reads the keychain as
                // "not configured"; once it becomes readable, the stores built
                // against that empty state hold dead API clients — rebuild
                // them rather than just revealing the main app.
                guard ServerConnectionStore.shared.hasConfiguration else { return }
                activateServerConnection()
            }
        }
    }

    private var mainApp: some View {
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
            .badge(projectStore.statusMonitor.brainBadgeCount)
            Tab("Hub", systemImage: "square.grid.2x2.fill", value: .hub) {
                NavigationStack(path: $hubPath) {
                    HubView(
                        navigationPath: $hubPath,
                        openSettings: { switchTab(to: .settings) }
                    )
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
                    SettingsView(onConnect: connect)
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
        .task { await modelCatalog.loadIfNeeded() }
        .onChange(of: projectStore.pendingNavigation) { _, workspace in
            guard let workspace else { return }
            switchTab(to: .hub)
            // Deferred one tick so navigation animates after UIKit animations re-enable.
            DispatchQueue.main.async { hubPath.append(workspace) }
            projectStore.pendingNavigation = nil
        }
        .onChange(of: scenePhase, initial: true) { _, newPhase in
            switch newPhase {
            case .background:
                backgroundedAt = Date()
                projectStore.statusMonitor.appDidBecomeInactive()
            case .inactive:
                projectStore.statusMonitor.appDidBecomeInactive()
            case .active:
                projectStore.statusMonitor.appDidBecomeActive()
                if let bg = backgroundedAt {
                    let elapsed = Date().timeIntervalSince(bg)
                    Task { await modelCatalog.load() }
                    if elapsed > 30 {
                        Task { await projectStore.refresh(force: true) }
                    }
                }
                backgroundedAt = nil
            @unknown default:
                projectStore.statusMonitor.appDidBecomeInactive()
            }
        }
    }

    /// Settings path: validate, persist, and activate in one step.
    @MainActor
    private func connect(_ candidate: ServerConnection) async -> Bool {
        guard await establishConnection(candidate) else { return false }
        activateServerConnection()
        return true
    }

    /// Validates the candidate against the server and persists it on success.
    /// Activation is separate so onboarding can play its success beat before
    /// the main app is revealed.
    @MainActor
    private func establishConnection(_ candidate: ServerConnection) async -> Bool {
        let isReachable = await withTaskGroup(of: Bool.self, returning: Bool.self) { group in
            group.addTask {
                do {
                    _ = try await APIClient(connection: candidate).fetchProjects()
                    return true
                } catch {
                    return false
                }
            }
            group.addTask {
                try? await Task.sleep(for: .seconds(5))
                return false
            }
            let result = await group.next() ?? false
            group.cancelAll()
            return result
        }
        guard isReachable else { return false }

        do {
            try ServerConnectionStore.shared.replace(with: candidate)
        } catch {
            return false
        }

        return true
    }

    /// Called by onboarding after its success animation: reveal the main app
    /// with a fade-and-settle transition.
    @MainActor
    private func completeOnboarding() {
        // The locked-launch scenePhase handler may have activated already if
        // the app was backgrounded during the success beat.
        guard !hasServerConnection else { return }
        if UIAccessibility.isReduceMotionEnabled {
            activateServerConnection()
        } else {
            withAnimation(.easeOut(duration: 0.45)) { activateServerConnection() }
        }
    }

    /// Tears down all per-server state and rebuilds the stores against the
    /// currently stored connection. Stores capture their API client at init,
    /// so any store created before the connection was readable must be
    /// replaced, never reused.
    @MainActor
    private func activateServerConnection() {
        hubPath = NavigationPath()
        brainPath = NavigationPath()
        projectStore.statusMonitor.disconnectAll()
        storeCache.clear()
        ImageCache.shared.clear()
        ChatDraftStore.shared.clear()
        DiffReviewStore.shared.clear()
        HubView.clearExpansionOverrides()
        HiveHTTP.clearCache()

        let newStoreCache = ConversationStoreCache()
        let newProjectStore = ProjectStore(storeCache: newStoreCache)
        let newModelCatalog = ModelCatalog()
        storeCache = newStoreCache
        projectStore = newProjectStore
        modelCatalog = newModelCatalog
        hasServerConnection = true
        serverGeneration += 1

        Task {
            async let projects: Void = newProjectStore.refresh(force: true)
            async let models: Void = newModelCatalog.load()
            _ = await (projects, models)
        }
    }
}

enum AppTab: Hashable {
    case brain, hub, settings
}
