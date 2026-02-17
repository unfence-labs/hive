import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            Tab("Hub", systemImage: "square.grid.2x2") {
                HubView()
            }
            Tab("Settings", systemImage: "gear") {
                SettingsView()
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
    }
}

#Preview {
    ContentView()
        .preferredColorScheme(.dark)
}
