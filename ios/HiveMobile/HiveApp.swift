import SwiftUI

@main
struct HiveApp: App {
    @State private var projectStore = ProjectStore()
    @State private var selectedTab: AppTab = .hub
    @AppStorage("hiveAccent") private var accentId = "violet"

    private var accent: Color {
        AccentOption(rawValue: accentId)?.color ?? AccentOption.violet.color
    }

    var body: some Scene {
        WindowGroup {
            TabView(selection: $selectedTab) {
                Tab("Hub", systemImage: "square.grid.2x2.fill", value: .hub) {
                    NavigationStack {
                        HubView()
                            .navigationDestination(for: Workspace.self) { workspace in
                                ChatView(workspace: workspace)
                                    .toolbar(.hidden, for: .tabBar)
                            }
                    }
                    .tint(.white)
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
        }
    }
}

enum AppTab: Hashable {
    case hub, settings
}
