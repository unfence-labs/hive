import SwiftUI

/// Displays a project avatar: favicon from the server if available, otherwise a colored letter.
struct ProjectAvatar: View {
    let projectId: String
    let projectName: String
    let hasFaviconFlag: Bool

    @State private var favicon: UIImage?

    init(project: Project) {
        self.projectId = project.id
        self.projectName = project.name
        self.hasFaviconFlag = project.hasFavicon == true
        if hasFaviconFlag {
            let host = UserDefaults.standard.string(forKey: "serverHost") ?? "localhost"
            let port = UserDefaults.standard.string(forKey: "serverPort") ?? "3000"
            let urlString = "http://\(host):\(port)/api/projects/\(project.id)/favicon"
            _favicon = State(initialValue: ImageCache.shared.image(forKey: ImageCache.key(for: urlString)))
        }
    }

    init(id: String, name: String, hasFavicon: Bool?) {
        self.projectId = id
        self.projectName = name
        self.hasFaviconFlag = hasFavicon == true
        if hasFaviconFlag {
            let host = UserDefaults.standard.string(forKey: "serverHost") ?? "localhost"
            let port = UserDefaults.standard.string(forKey: "serverPort") ?? "3000"
            let urlString = "http://\(host):\(port)/api/projects/\(id)/favicon"
            _favicon = State(initialValue: ImageCache.shared.image(forKey: ImageCache.key(for: urlString)))
        }
    }

    private static let palette: [Color] = [
        Color(red: 0.722, green: 0.263, blue: 0.141),
        Color(red: 0.333, green: 0.369, blue: 0.439),
        Color(red: 0.271, green: 0.427, blue: 0.533),
        Color(red: 0.286, green: 0.478, blue: 0.447),
        Color(red: 0.408, green: 0.424, blue: 0.631),
        Color(red: 0.471, green: 0.380, blue: 0.529),
        Color(red: 0.518, green: 0.345, blue: 0.420),
    ]

    private var fallbackColor: Color {
        let hash = projectName.unicodeScalars.reduce(0) { (($0 &<< 5) &- $0) &+ Int($1.value) }
        return Self.palette[abs(hash) % Self.palette.count]
    }

    private var faviconURLString: String? {
        guard hasFaviconFlag else { return nil }
        let host = UserDefaults.standard.string(forKey: "serverHost") ?? "localhost"
        let port = UserDefaults.standard.string(forKey: "serverPort") ?? "3000"
        return "http://\(host):\(port)/api/projects/\(projectId)/favicon"
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
        .task(id: projectId) { await loadFavicon() }
    }

    private var letterFallback: some View {
        Text(String(projectName.prefix(1)).uppercased())
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(fallbackColor)
            .frame(width: 20, height: 20)
            .background(fallbackColor.opacity(0.2), in: RoundedRectangle(cornerRadius: 4))
    }

    private func loadFavicon() async {
        guard favicon == nil,
              let urlString = faviconURLString, let url = URL(string: urlString) else { return }
        let key = ImageCache.key(for: urlString)

        guard let (data, _) = try? await URLSession.shared.data(from: url),
              let image = UIImage(data: data) else { return }
        ImageCache.shared.store(image, forKey: key)
        favicon = image
    }
}
