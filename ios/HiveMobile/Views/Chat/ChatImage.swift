import ImageIO
import SwiftUI
import UIKit
import UniformTypeIdentifiers

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
    private(set) var fullResolutionFailed = false

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
        guard let decoded = await Self.decode(source: source, maxSize: maxSize) else {
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

    /// Full-resolution load that first shows the tile's cached thumbnail (if any)
    /// so a hero zoom has an image to animate from the very first frame, then
    /// swaps to the full image without ever flashing a blank/loading state.
    func loadFull(source: String, previewSize: CGSize) async {
        fullResolutionFailed = false
        let thumbKey = Self.cacheKey(source: source, maxSize: previewSize)
        if loadedImage == nil, let thumb = ImageCache.shared.image(forKey: thumbKey) {
            state = .loaded(thumb)
            loadedKey = thumbKey
        }

        let fullKey = Self.cacheKey(source: source, maxSize: nil)
        if loadedKey == fullKey, case .loaded = state { return }
        if let cached = ImageCache.shared.image(forKey: fullKey) {
            state = .loaded(cached)
            loadedKey = fullKey
            return
        }

        if loadedImage == nil { state = .loading }
        guard let decoded = await Self.decode(source: source, maxSize: nil) else {
            fullResolutionFailed = true
            if loadedImage == nil { state = .failed }
            return
        }
        ImageCache.shared.store(decoded, forKey: fullKey)
        state = .loaded(decoded)
        loadedKey = fullKey
    }

    private static func cacheKey(source: String, maxSize: CGSize?) -> String {
        let base = ImageCache.key(for: source)
        guard let maxSize else { return base }
        return "\(base)@\(Int(maxSize.width))x\(Int(maxSize.height))"
    }

    static func cachedImage(source: String, maxSize: CGSize?) -> UIImage? {
        ImageCache.shared.image(forKey: cacheKey(source: source, maxSize: maxSize))
    }

    nonisolated private static func decode(source: String, maxSize: CGSize?) async -> UIImage? {
        let maxPixel = maxSize.map { max($0.width, $0.height) * 3 }
        let data: Data
        if source.hasPrefix("data:") {
            guard let range = source.range(of: ";base64,") else { return nil }
            let base64 = String(source[range.upperBound...])
            guard let decoded = Data(base64Encoded: base64, options: .ignoreUnknownCharacters) else { return nil }
            data = decoded
        } else {
            var fetchSource = source
            if let maxPixel {
                fetchSource += (source.contains("?") ? "&" : "?") + "w=\(Int(maxPixel.rounded()))"
            }
            guard let url = ChatImageResolver.apiURL(for: fetchSource) else { return nil }
            guard let (fetched, response) = try? await HiveHTTP.session.data(from: url),
                  let response = response as? HTTPURLResponse,
                  (200...299).contains(response.statusCode) else { return nil }
            data = fetched
        }
        if let maxPixel, let downsampled = downsample(data: data, maxPixel: maxPixel) {
            return downsampled
        }
        return UIImage(data: data)
    }

    nonisolated private static func downsample(data: Data, maxPixel: CGFloat) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary) else {
            return nil
        }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ]
        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            return nil
        }
        return UIImage(cgImage: cgImage)
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

    @State private var tileFrameProbe = TileFrameProbe()
    @State private var lightboxPresentation: LightboxPresentation?

    private var hasSource: Bool { !(source?.isEmpty ?? true) }

    var body: some View {
        ChatImageTile(
            source: source,
            pending: pending,
            size: size,
            cornerRadius: cornerRadius,
            noPreviewMessage: noPreviewMessage,
            onOpenLightbox: hasSource ? present : nil
        )
        .background(TileFrameProbeView(probe: tileFrameProbe))
        .opacity(lightboxPresentation == nil ? 1 : 0)
        .allowsHitTesting(lightboxPresentation == nil)
        .fullScreenCover(item: $lightboxPresentation) { presentation in
            ChatImageLightboxHost(presentation: presentation) {
                lightboxPresentation = nil
            }
        }
    }

    // Read the UIKit view's window rect at tap time. SwiftUI GeometryProxy
    // values captured before the first scroll can still be the initial zero
    // layout; UIKit conversion reflects the view that actually received the tap.
    private func present() {
        guard let source, hasSource else { return }

        let frame = tileFrameProbe.frameInWindow() ?? .zero
        let initialImage = ChatImageLoader.cachedImage(source: source, maxSize: size)
        let presentation = LightboxPresentation(
            source: source,
            sourceFrame: frame,
            sourceSize: size,
            sourceCornerRadius: cornerRadius,
            initialImage: initialImage
        )
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            lightboxPresentation = presentation
        }
    }
}

private struct ChatImageLightboxHost: View {
    let presentation: LightboxPresentation
    let dismiss: () -> Void

    var body: some View {
        ChatImageLightbox(
            source: presentation.source,
            isPresented: Binding(
                get: { true },
                set: { if !$0 { dismiss() } }
            ),
            sourceFrame: presentation.sourceFrame,
            sourceSize: presentation.sourceSize,
            sourceCornerRadius: presentation.sourceCornerRadius,
            initialImage: presentation.initialImage
        )
        // Transparent so the lightbox owns its own dim backdrop and we never
        // see the opaque system cover behind it.
        .presentationBackground(.clear)
    }
}

private struct LightboxPresentation: Identifiable {
    let id = UUID()
    let source: String
    let sourceFrame: CGRect
    let sourceSize: CGSize
    let sourceCornerRadius: CGFloat
    let initialImage: UIImage?
}

private final class TileFrameProbe {
    weak var view: UIView?

    func frameInWindow() -> CGRect? {
        guard let view, let window = view.window, view.bounds.hasUsableSize else { return nil }
        return view.convert(view.bounds, to: window)
    }
}

private struct TileFrameProbeView: UIViewRepresentable {
    let probe: TileFrameProbe

    func makeUIView(context: Context) -> UIView {
        let view = UIView(frame: .zero)
        view.backgroundColor = .clear
        view.isUserInteractionEnabled = false
        probe.view = view
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        probe.view = uiView
    }
}

private extension CGRect {
    var hasUsableSize: Bool {
        width > 0 && height > 0
    }
}

// MARK: - Lightbox

/// Full-screen single-image lightbox. Tapping the backdrop or image dismisses
/// it. Shared by chat attachments and image activities.
/// Mirrors `frontend/src/components/chat/ImageLightbox.tsx`.
struct ChatImageLightbox: View {
    let source: String
    @Binding var isPresented: Bool
    let sourceFrame: CGRect
    let sourceSize: CGSize
    let sourceCornerRadius: CGFloat
    let initialImage: UIImage?

    @State private var loader = ChatImageLoader()
    @State private var revealed = false
    @State private var drag: CGSize = .zero
    @State private var exportTask: Task<Void, Never>?
    @State private var isPreparingExport = false
    @State private var sharedImage: ChatImageExport?
    @State private var showExportError = false

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

    var body: some View {
        GeometryReader { safeArea in
            GeometryReader { geo in
                ZStack {
                    Color.black
                        .opacity(backdropOpacity)
                        .ignoresSafeArea()

                    heroImage(screen: geo.size)
                }
                .frame(width: geo.size.width, height: geo.size.height)
                .contentShape(Rectangle())
                .gesture(dragGesture)
                .onTapGesture { close() }
            }
            // Preserve the window coordinates used by the hero animation.
            .ignoresSafeArea()
            .overlay(alignment: .top) {
                imageControls
                    .padding(.top, safeArea.safeAreaInsets.top)
                    .background(.black.opacity(0.6))
                    .opacity(revealed ? 1 : 0)
                    .allowsHitTesting(revealed)
            }
        }
        .overlay(alignment: .bottom) {
            if loader.fullResolutionFailed {
                Text("Couldn't load the original image. Check your connection or try reopening it.")
                    .font(.callout)
                    .foregroundStyle(.white)
                    .padding()
                    .background(.black.opacity(0.75))
                    .padding()
            }
        }
        .sheet(item: $sharedImage) { image in
            ChatImageShareSheet(image: image) { failed in
                sharedImage = nil
                showExportError = failed
            }
        }
        .alert("Couldn't share image", isPresented: $showExportError) {
            Button("OK", role: .cancel) { }
        } message: {
            Text("The original image couldn't be prepared or shared. Check your connection and try again.")
        }
        .task(id: source) { await loader.loadFull(source: source, previewSize: sourceSize) }
        .onDisappear {
            exportTask?.cancel()
            exportTask = nil
            isPreparingExport = false
        }
        .onAppear {
            withAnimation(.spring(response: 0.28, dampingFraction: 0.85)) {
                revealed = true
            }
        }
    }

    private var imageControls: some View {
        HStack {
            Button(action: close) {
                Image(systemName: "xmark")
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("Close image")

            Spacer()

            Button(action: shareOriginal) {
                Group {
                    if isPreparingExport {
                        ProgressView().tint(.white)
                    } else {
                        Image(systemName: "square.and.arrow.up")
                    }
                }
                .frame(width: 44, height: 44)
            }
            .disabled(isPreparingExport)
            .accessibilityLabel(isPreparingExport ? "Preparing original image" : "Share or save original image")
        }
        .font(.system(size: 18, weight: .semibold))
        .foregroundStyle(.white)
        .buttonStyle(.plain)
        .padding(.horizontal, 12)
    }

    /// The image, animating its frame/position/corner-radius between the tile's
    /// rect (collapsed) and the centered fitted rect (expanded). `scaledToFill`
    /// matches the tile's crop while collapsed and shows the whole image once
    /// the expanded frame carries the image's own aspect ratio.
    @ViewBuilder
    private func heroImage(screen: CGSize) -> some View {
        let expanded = expandedSize(screen: screen)
        let collapsedSize = sourceFrame.size == .zero ? sourceSize : sourceFrame.size
        let curSize = revealed ? expanded : collapsedSize

        let expandedCenter = CGPoint(x: screen.width / 2, y: screen.height / 2)
        let collapsedCenter = sourceFrame == .zero
            ? expandedCenter
            : CGPoint(x: sourceFrame.midX, y: sourceFrame.midY)
        let baseCenter = revealed ? expandedCenter : collapsedCenter
        let center = CGPoint(x: baseCenter.x + drag.width, y: baseCenter.y + drag.height)

        let radius = revealed ? 0 : sourceCornerRadius
        let dragScale = revealed ? (1 - dragProgress * 0.25) : 1

        imageContent
            .frame(width: curSize.width, height: curSize.height)
            .clipShape(RoundedRectangle(cornerRadius: radius))
            .scaleEffect(dragScale)
            .position(center)
    }

    @ViewBuilder
    private var imageContent: some View {
        if let image = loader.loadedImage ?? initialImage {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
        } else if loader.isError {
            ZStack {
                Color.black.opacity(0.3)
                Image(systemName: "photo")
                    .font(.system(size: 44))
                    .foregroundStyle(.white.opacity(0.5))
            }
        } else {
            ZStack {
                Color.black.opacity(0.2)
                ProgressView().tint(.white)
            }
        }
    }

    /// Aspect-fit the loaded image into the screen (inset a little), or fill the
    /// inset bounds until it loads.
    private func expandedSize(screen: CGSize) -> CGSize {
        let bounds = CGSize(width: max(screen.width - 24, 1), height: max(screen.height - 48, 1))
        guard let image = loader.loadedImage ?? initialImage, image.size.width > 0, image.size.height > 0 else {
            return bounds
        }
        let scale = min(bounds.width / image.size.width, bounds.height / image.size.height)
        return CGSize(width: image.size.width * scale, height: image.size.height * scale)
    }

    private var dragGesture: some Gesture {
        DragGesture()
            .onChanged { drag = $0.translation }
            .onEnded { value in
                if hypot(value.translation.width, value.translation.height) > dismissThreshold {
                    close()
                } else {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.82)) { drag = .zero }
                }
            }
    }

    /// Reverse the zoom back into the tile (frame/position/radius) while the
    /// backdrop fades out, then remove the cover without the system slide.
    private func close() {
        exportTask?.cancel()
        withAnimation(.easeInOut(duration: 0.2)) {
            revealed = false
            drag = .zero
        } completion: {
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) { isPresented = false }
        }
    }

    private func shareOriginal() {
        guard !isPreparingExport else { return }
        isPreparingExport = true
        exportTask = Task {
            defer {
                isPreparingExport = false
                exportTask = nil
            }
            do {
                let image = try await Self.prepareExport(source: source)
                try Task.checkCancellation()
                sharedImage = image
            } catch {
                if !Task.isCancelled { showExportError = true }
            }
        }
    }

    /// Fetch again without a thumbnail width; the display cache can still contain
    /// a small preview when the full-resolution load failed.
    nonisolated private static func prepareExport(source: String) async throws -> ChatImageExport {
        let data: Data
        if source.hasPrefix("data:") {
            guard let range = source.range(of: ";base64,"),
                  let decoded = Data(base64Encoded: String(source[range.upperBound...])) else {
                throw ChatImageExport.ExportError.invalidImage
            }
            data = decoded
        } else {
            guard var components = URLComponents(string: source) else {
                throw ChatImageExport.ExportError.invalidImage
            }
            components.queryItems = components.queryItems?.filter { $0.name != "w" }
            components.percentEncodedQuery = components.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
            guard let originalSource = components.string,
                  let url = ChatImageResolver.apiURL(for: originalSource) else {
                throw ChatImageExport.ExportError.invalidImage
            }
            let (downloaded, response) = try await HiveHTTP.session.data(from: url)
            guard let response = response as? HTTPURLResponse, (200...299).contains(response.statusCode) else {
                throw ChatImageExport.ExportError.invalidImage
            }
            data = downloaded
        }
        try Task.checkCancellation()
        guard let image = CGImageSourceCreateWithData(data as CFData, nil),
              CGImageSourceGetCount(image) > 0,
              let identifier = CGImageSourceGetType(image),
              let fileExtension = UTType(identifier as String)?.preferredFilenameExtension else {
            throw ChatImageExport.ExportError.invalidImage
        }
        return try ChatImageExport(data: data, fileExtension: fileExtension)
    }
}

private struct ChatImageShareSheet: UIViewControllerRepresentable {
    let image: ChatImageExport
    let onComplete: (Bool) -> Void

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(activityItems: [image.url], applicationActivities: nil)
        controller.completionWithItemsHandler = { _, _, _, error in
            Task { @MainActor in onComplete(error != nil) }
        }
        return controller
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) { }
}
