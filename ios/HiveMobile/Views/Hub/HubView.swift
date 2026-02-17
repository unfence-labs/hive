import SwiftUI

struct HubView: View {
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    ContentUnavailableView(
                        "No Projects",
                        systemImage: "folder",
                        description: Text("Connect to your Hive server in Settings to see your projects.")
                    )
                }
                .padding()
            }
            .navigationTitle("Hub")
        }
    }
}

#Preview {
    HubView()
        .preferredColorScheme(.dark)
}
