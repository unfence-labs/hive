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

    private var hasSource: Bool { !(source?.isEmpty ?? true) }

    var body: some View {
        ChatImageTile(
            source: source,
            pending: pending,
            size: size,
            cornerRadius: cornerRadius,
            noPreviewMessage: noPreviewMessage,
            onOpenLightbox: hasSource ? { present() } : nil
        )
        .fullScreenCover(isPresented: $showLightbox) {
            if let source, hasSource {
                ChatImageLightbox(source: source, isPresented: $showLightbox)
                    // Transparent so the lightbox owns its own dim backdrop and
                    // we never see the opaque system cover behind it.
                    .presentationBackground(.clear)
            }
        }
    }

    // Present without the system slide; the lightbox runs its own fade/zoom in.
    private func present() {
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) { showLightbox = true }
    }
}

// MARK: - Lightbox

/// Full-screen single-image lightbox. Tapping the backdrop, the image, or the
/// close button dismisses it. Shared by chat attachments and image activities.
/// Mirrors `frontend/src/components/chat/ImageLightbox.tsx`.
struct ChatImageLightbox: View {
    let source: String
    @Binding var isPresented: Bool

    @State private var loader = ChatImageLoader()
    @State private var revealed = false
    @State private var drag: CGSize = .zero

    /// Drag distance (pts) at which the backdrop reaches 0; release past
    /// `dismissThreshold` dismisses, otherwise the image springs back.
    private let dismissDistance: CGFloat = 220
    private let dismissThreshold: CGFloat = 110

    private var dragAmount: CGFloat { hypot(drag.width, drag.height) }
    private var dragProgress: CGFloat { min(dragAmount / dismissDistance, 1) }

    /// Backdrop opacity is coupled to both the enter/exit reveal and the live
    /// drag, so it is ~0 whenever the image is small/near the tile and 1 only
    /// when the image sits full-screen — the Telegram-style behavior.
    private var backdropOpacity: Double {
        guard revealed else { return 0 }
        return Double(1 - dragProgress)
    }

    private var imageScale: CGFloat {
        guard revealed else { return 0.82 }
        return 1 - dragProgress * 0.3
    }

    var body: some View {
        ZStack {
            Color.black
                .opacity(backdropOpacity)
                .ignoresSafeArea()

            imageContent
                .scaleEffect(imageScale)
                .offset(drag)
                .opacity(revealed ? 1 : 0)

            closeButton
                .opacity(backdropOpacity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
        .gesture(dragGesture)
        .onTapGesture { close(translation: drag) }
        .task(id: source) { await loader.load(source: source, maxSize: nil) }
        .onAppear {
            withAnimation(.spring(response: 0.34, dampingFraction: 0.86)) {
                revealed = true
            }
        }
    }

    @ViewBuilder
    private var imageContent: some View {
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
    }

    private var closeButton: some View {
        VStack {
            HStack {
                Spacer()
                Button { close(translation: .zero) } label: {
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

    private var dragGesture: some Gesture {
        DragGesture()
            .onChanged { drag = $0.translation }
            .onEnded { value in
                if hypot(value.translation.width, value.translation.height) > dismissThreshold {
                    close(translation: value.translation)
                } else {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.82)) { drag = .zero }
                }
            }
    }

    /// Shrink + fade the image (continuing any drag) while the backdrop fades
    /// out, then remove the cover without the system slide.
    private func close(translation: CGSize) {
        withAnimation(.easeOut(duration: 0.24)) {
            revealed = false
            drag = translation
        } completion: {
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) { isPresented = false }
        }
    }
}
