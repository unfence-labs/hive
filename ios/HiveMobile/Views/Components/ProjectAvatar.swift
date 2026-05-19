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
        Color(red: 0.584, green: 0.416, blue: 0.243),
        Color(red: 0.361, green: 0.502, blue: 0.376),
        Color(red: 0.239, green: 0.482, blue: 0.522),
        Color(red: 0.322, green: 0.392, blue: 0.620),
        Color(red: 0.463, green: 0.349, blue: 0.580),
        Color(red: 0.584, green: 0.318, blue: 0.416),
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
