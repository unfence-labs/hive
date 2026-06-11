import SwiftUI
import UIKit

// MARK: - Loader

/// Loads and caches a chat image from a `data:` URL or an `/api/...` path.
///
/// Shared by the inline tile (thumbnail-cached at its display size) and the
/// lightbox (full-resolution). Mirrors the load/loaded/error states of the
/// web `useImageLoadStatus` hook.
@MainActor
@Observable
final class ChatImageLoader {
    private enum LoadState {
        case idle
        case loading
        case loaded(UIImage)
        case failed
    }

    private var state: LoadState = .idle
    private var loadedKey: String?

    var loadedImage: UIImage? {
        if case .loaded(let image) = state { return image }
        return nil
    }

    var isError: Bool {
        if case .failed = state { return true }
        return false
    }

    /// Loads `source`, downscaling to `maxSize` (in points) when provided so the
    /// inline tile stays memory-light; pass `nil` for a full-resolution image.
    func load(source: String?, maxSize: CGSize?) async {
        guard let source, !source.isEmpty else {
            state = .idle
            return
        }

        let key = Self.cacheKey(source: source, maxSize: maxSize)
        if loadedKey == key, case .loaded = state { return }

        if let cached = ImageCache.shared.image(forKey: key) {
            state = .loaded(cached)
            loadedKey = key
            return
        }

        state = .loading
        guard let decoded = await Self.decode(source: source) else {
            state = .failed
            return
        }

        if let maxSize {
            ImageCache.shared.storeThumbnail(decoded, forKey: key, maxSize: maxSize)
            state = .loaded(ImageCache.shared.image(forKey: key) ?? decoded)
        } else {
            ImageCache.shared.store(decoded, forKey: key)
            state = .loaded(decoded)
        }
        loadedKey = key
    }

    private static func cacheKey(source: String, maxSize: CGSize?) -> String {
        let base = ImageCache.key(for: source)
        guard let maxSize else { return base }
        return "\(base)@\(Int(maxSize.width))x\(Int(maxSize.height))"
    }

    nonisolated private static func decode(source: String) async -> UIImage? {
        if source.hasPrefix("data:") {
            guard let range = source.range(of: ";base64,") else { return nil }
            let base64 = String(source[range.upperBound...])
            guard let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters) else { return nil }
            return UIImage(data: data)
        }

        guard let url = ChatImageResolver.apiURL(for: source) else { return nil }
        guard let (data, _) = try? await URLSession.shared.data(from: url) else { return nil }
        return UIImage(data: data)
    }
}

// MARK: - Tile

/// Fixed-size thumbnail tile covering every image state without reflow: an
/// animated generating placeholder, the brief decode window, the loaded image
/// (optionally tappable to a lightbox), a load error, or a no-preview notice.
/// Mirrors `frontend/src/components/chat/ImageTile.tsx`.
struct ChatImageTile: View {
    let source: String?
    var pending: Bool = false
    var size: CGSize
    var cornerRadius: CGFloat = 6
    var noPreviewMessage: String? = nil
    var onOpenLightbox: (() -> Void)? = nil

    @State private var loader = ChatImageLoader()

    private var hasSource: Bool { !(source?.isEmpty ?? true) }

    var body: some View {
        let loaded = loader.loadedImage
        let showImage = hasSource && !pending && loaded != nil
        let showError = hasSource && !pending && loader.isError
        // Idle (pre-task) and loading both render the static decode placeholder,
        // so a sourced tile never flashes an empty frame before loading starts.
        let decoding = hasSource && !pending && loaded == nil && !loader.isError
        let showPlaceholder = pending || decoding
        let showNoPreview = !hasSource && !pending

        ZStack {
            WhisperColor.toolIconBg

            if showImage, let loaded {
                Image(uiImage: loaded)
                    .resizable()
                    .scaledToFill()
            }

            if showPlaceholder {
                ImageTilePlaceholder(generating: pending)
            }

            if showError || showNoPreview {
                Image(systemName: "photo")
                    .font(.system(size: min(size.width, size.height) * 0.3))
                    .foregroundStyle(WhisperColor.textMuted)
            }
        }
        .frame(width: size.width, height: size.height)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
        .overlay(
            RoundedRectangle(cornerRadius: cornerRadius)
                .strokeBorder(WhisperColor.border, lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: cornerRadius))
        .accessibilityLabel(accessibilityLabel(pending: pending, noPreview: showNoPreview))
        .onTapGesture {
            if showImage { onOpenLightbox?() }
        }
        .task(id: "\(pending)|\(source ?? "")") {
            guard !pending, hasSource else { return }
            await loader.load(source: source, maxSize: size)
        }
    }

    private func accessibilityLabel(pending: Bool, noPreview: Bool) -> String {
        if pending { return "Generating image" }
        if noPreview, let noPreviewMessage { return noPreviewMessage }
        return ""
    }
}

/// The generating (animated sheen + pulse) and decoding (static) placeholders.
private struct ImageTilePlaceholder: View {
    let generating: Bool
    @State private var pulse = false

    var body: some View {
        ZStack {
            if generating {
                Color.accentColor
                    .opacity(pulse ? 0.24 : 0.12)
                    .animation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: pulse)
                ImageSheen()
            } else {
                WhisperColor.surfaceSubtle
            }
        }
        .onAppear { pulse = true }
    }
}

/// A left-to-right shimmer sweep, the SwiftUI counterpart of the web `animate-sheen`.
private struct ImageSheen: View {
    @State private var phase: CGFloat = -1

    var body: some View {
        GeometryReader { geo in
            LinearGradient(
                colors: [.clear, .white.opacity(0.28), .clear],
                startPoint: .leading,
                endPoint: .trailing
            )
            .frame(width: geo.size.width)
            .offset(x: phase * geo.size.width * 2)
            .onAppear {
                withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) {
                    phase = 1
                }
            }
        }
        .allowsHitTesting(false)
    }
}

/// A tile paired with a full-screen lightbox opened on tap once loaded.
struct ChatImageTileWithLightbox: View {
    let source: String?
    var pending: Bool = false
    var size: CGSize
    var cornerRadius: CGFloat = 6
    var noPreviewMessage: String? = nil

    @State private var showLightbox = false
    @Namespace private var transitionNamespace

    private var hasSource: Bool { !(source?.isEmpty ?? true) }

    var body: some View {
        ChatImageTile(
            source: source,
            pending: pending,
            size: size,
            cornerRadius: cornerRadius,
            noPreviewMessage: noPreviewMessage,
            onOpenLightbox: hasSource ? { showLightbox = true } : nil
        )
        // Zoom transition (iOS 18+): the lightbox expands from the tile's
        // position instead of the default modal slide-up.
        .matchedTransitionSource(id: "image", in: transitionNamespace)
        .fullScreenCover(isPresented: $showLightbox) {
            if let source, hasSource {
                ChatImageLightbox(source: source)
                    .navigationTransition(.zoom(sourceID: "image", in: transitionNamespace))
            }
        }
    }
}

// MARK: - Lightbox

/// Full-screen single-image lightbox. Tapping the backdrop, the image, or the
/// close button dismisses it. Shared by chat attachments and image activities.
/// Mirrors `frontend/src/components/chat/ImageLightbox.tsx`.
struct ChatImageLightbox: View {
    let source: String

    @Environment(\.dismiss) private var dismiss
    @State private var loader = ChatImageLoader()

    var body: some View {
        ZStack {
            Color.black.opacity(0.92).ignoresSafeArea()

            if let image = loader.loadedImage {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .padding()
            } else if loader.isError {
                Image(systemName: "photo")
                    .font(.system(size: 44))
                    .foregroundStyle(.white.opacity(0.5))
            } else {
                ProgressView().tint(.white)
            }

            VStack {
                HStack {
                    Spacer()
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(WhisperColor.text)
                            .padding(10)
                            .background(WhisperColor.imageControlBg, in: Circle())
                    }
                    .padding(.top, 8)
                    .padding(.trailing, 16)
                }
                Spacer()
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { dismiss() }
        .task(id: source) { await loader.load(source: source, maxSize: nil) }
    }
}
