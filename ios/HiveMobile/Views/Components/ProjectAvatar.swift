import SwiftUI

/// Displays a project avatar: favicon from the server if available, otherwise a colored letter.
struct ProjectAvatar: View {
    let project: Project

    private static let palette: [Color] = [
        .red, .orange, .yellow, .green, .teal, .blue, .indigo, .purple, .pink,
    ]

    private var fallbackColor: Color {
        let hash = project.name.unicodeScalars.reduce(0) { (($0 &<< 5) &- $0) &+ Int($1.value) }
        return Self.palette[abs(hash) % Self.palette.count]
    }

    private var faviconURL: URL? {
        guard project.hasFavicon == true else { return nil }
        let host = UserDefaults.standard.string(forKey: "serverHost") ?? "localhost"
        let port = UserDefaults.standard.string(forKey: "serverPort") ?? "3000"
        return URL(string: "http://\(host):\(port)/api/projects/\(project.id)/favicon")
    }

    var body: some View {
        if let url = faviconURL {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFit()
                default:
                    letterFallback
                }
            }
            .frame(width: 20, height: 20)
            .clipShape(RoundedRectangle(cornerRadius: 4))
        } else {
            letterFallback
        }
    }

    private var letterFallback: some View {
        Text(String(project.name.prefix(1)).uppercased())
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(fallbackColor)
            .frame(width: 20, height: 20)
            .background(fallbackColor.opacity(0.2), in: RoundedRectangle(cornerRadius: 4))
    }
}
