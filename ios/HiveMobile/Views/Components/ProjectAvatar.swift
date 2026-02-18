import SwiftUI

/// Displays a project avatar: favicon from the server if available, otherwise a colored letter.
struct ProjectAvatar: View {
    let project: Project
    @State private var favicon: UIImage?

    private static let palette: [Color] = [
        .red, .orange, .yellow, .green, .teal, .blue, .indigo, .purple, .pink,
    ]

    private var fallbackColor: Color {
        let hash = project.name.unicodeScalars.reduce(0) { (($0 &<< 5) &- $0) &+ Int($1.value) }
        return Self.palette[abs(hash) % Self.palette.count]
    }

    private var faviconURLString: String? {
        guard project.hasFavicon == true else { return nil }
        let host = UserDefaults.standard.string(forKey: "serverHost") ?? "localhost"
        let port = UserDefaults.standard.string(forKey: "serverPort") ?? "3000"
        return "http://\(host):\(port)/api/projects/\(project.id)/favicon"
    }

    var body: some View {
        Group {
            if let favicon {
                Image(uiImage: favicon)
                    .resizable()
                    .scaledToFit()
            } else {
                letterFallback
            }
        }
        .frame(width: 20, height: 20)
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .task(id: project.id) { await loadFavicon() }
    }

    private var letterFallback: some View {
        Text(String(project.name.prefix(1)).uppercased())
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(fallbackColor)
            .frame(width: 20, height: 20)
            .background(fallbackColor.opacity(0.2), in: RoundedRectangle(cornerRadius: 4))
    }

    private func loadFavicon() async {
        guard let urlString = faviconURLString, let url = URL(string: urlString) else { return }
        let key = ImageCache.key(for: urlString)

        if let cached = ImageCache.shared.image(forKey: key) {
            favicon = cached
            return
        }

        guard let (data, _) = try? await URLSession.shared.data(from: url),
              let image = UIImage(data: data) else { return }
        ImageCache.shared.store(image, forKey: key)
        favicon = image
    }
}
