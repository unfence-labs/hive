import SwiftUI

@main
struct HiveApp: App {
    var body: some Scene {
        WindowGroup {
            NavigationStack {
                HubView()
                    .navigationDestination(for: Workspace.self) { workspace in
                        ChatView(workspace: workspace)
                    }
                    .navigationDestination(for: SettingsRoute.self) { _ in
                        SettingsView()
                    }
            }
            .tint(.white)
            .preferredColorScheme(.dark)
        }
    }
}

/// Empty route type to enable NavigationLink-based push to Settings.
struct SettingsRoute: Hashable {}
