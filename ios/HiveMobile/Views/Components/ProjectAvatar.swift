import SwiftUI

/// Displays a project avatar: favicon from the server if available, otherwise a colored letter.
struct ProjectAvatar: View {
    let projectId: String
    let projectName: String
    let hasFaviconFlag: Bool
    let faviconVersion: String?

    @State private var favicon: UIImage?

    init(project: Project) {
        self.init(id: project.id, name: project.name, hasFavicon: project.hasFavicon, faviconVersion: project.faviconVersion)
    }

    init(id: String, name: String, hasFavicon: Bool?, faviconVersion: String? = nil) {
        self.projectId = id
        self.projectName = name
        self.hasFaviconFlag = hasFavicon == true
        self.faviconVersion = faviconVersion
        if hasFavicon == true {
            let source = Self.faviconSource(id: id, version: faviconVersion)
            _favicon = State(initialValue: ImageCache.shared.image(forKey: ImageCache.key(for: source)))
        }
    }

    private static func faviconSource(id: String, version: String?) -> String {
        var source = "/api/projects/\(id)/favicon"
        if let version { source += "?v=\(version)" }
        return source
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

    private var faviconSource: String? {
        hasFaviconFlag ? Self.faviconSource(id: projectId, version: faviconVersion) : nil
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
        .task(id: faviconSource) { await loadFavicon() }
    }

    private var letterFallback: some View {
        Text(String(projectName.prefix(1)).uppercased())
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(fallbackColor)
            .frame(width: 20, height: 20)
            .background(fallbackColor.opacity(0.2), in: RoundedRectangle(cornerRadius: 4))
    }

    private func loadFavicon() async {
        guard let source = faviconSource,
              let url = ChatImageResolver.apiURL(for: source) else { return }
        let key = ImageCache.key(for: source)
        if let cached = ImageCache.shared.image(forKey: key) {
            favicon = cached
            return
        }
        guard let (data, _) = try? await HiveHTTP.session.data(from: url),
              let image = UIImage(data: data) else { return }
        ImageCache.shared.store(image, forKey: key)
        favicon = image
    }
}
