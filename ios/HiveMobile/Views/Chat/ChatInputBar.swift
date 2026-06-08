import PhotosUI
import SwiftUI

struct ChatInputBar: View {
    @Binding var draft: String
    let draftAttachments: [ImageAttachment]
    let isBusy: Bool
    @Binding var planModeEnabled: Bool
    @Binding var thinkingLevel: ThinkingLevel
    @Binding var fastModeEnabled: Bool
    let models: [ModelCatalogEntry]
    let groupedModels: [ModelProviderGroup]
    let selectedModelId: String
    let defaultModelId: String
    let lockedProvider: String?
    let capabilities: ProviderCapabilities?
    let onModelSelect: (String) -> Void
    let contextUsage: ContextUsageData
    let onDraftAttachmentsChange: ([ImageAttachment]) -> Void
    let onSend: ([ImageAttachment]) -> Void
    var onStop: (() -> Void)?

    @AppStorage("hiveAccent") private var accentId = AccentOption.defaultId
    @State private var attachedImages: [AttachedImage] = []
    @State private var selectedItems: [PhotosPickerItem] = []

    private var hiveAccent: Color {
        AccentOption(rawValue: accentId)?.color ?? AccentOption.violet.color
    }

    var body: some View {
        VStack(spacing: 0) {
            // MARK: - Control Bar
            controlBar

            // MARK: - Attachment Chips
            if !attachedImages.isEmpty {
                attachmentChipTray
            }

            Divider()
                .overlay(WhisperColor.separator)

            // MARK: - Compose Area
            composeArea
        }
        .glassCard(cornerRadius: 20)
        .overlay(planModeOverlay)
        .onAppear {
            restoreAttachedImages(from: draftAttachments)
        }
        .onChange(of: selectedItems) {
            loadImages(from: selectedItems)
        }
        .onChange(of: draftAttachments) {
            restoreAttachedImages(from: draftAttachments)
        }
    }

    // MARK: - Control Bar

    private var selectedModelLabel: String {
        models.first { $0.id == selectedModelId }?.label ?? "Model"
    }

    private var thinkingLevels: [ThinkingLevel] { capabilities?.thinkingLevels ?? [] }
    private var supportsThinking: Bool { !thinkingLevels.isEmpty }
    private var supportsPlanMode: Bool { capabilities?.planMode ?? true }
    /// Fast mode is gated per-model (Opus-only), not by provider capabilities.
    private var supportsFastMode: Bool {
        models.first { $0.id == selectedModelId }?.supportsFastMode ?? false
    }

    /// Clamp the bound `thinkingLevel` to a value the current provider supports;
    /// prefer the user's current selection, else `.high`, else the provider's first level.
    private var effectiveThinkingLevel: ThinkingLevel {
        guard !thinkingLevels.isEmpty else { return thinkingLevel }
        if thinkingLevels.contains(thinkingLevel) { return thinkingLevel }
        if thinkingLevels.contains(.high) { return .high }
        return thinkingLevels[0]
    }

    private var controlBar: some View {
        HStack(spacing: 8) {
            Menu {
                ForEach(groupedModels) { group in
                    Section(group.providerLabel) {
                        ForEach(group.models) { model in
                            let isLocked = lockedProvider != nil && model.provider != lockedProvider
                            Button {
                                onModelSelect(model.id)
                            } label: {
                                HStack {
                                    Text(model.label)
                                    if model.isNew == true {
                                        Text("NEW")
                                    }
                                    if model.id == selectedModelId {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                            .disabled(isLocked)
                        }
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "sparkles")
                    Text(selectedModelLabel)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 8))
                }
                .font(.caption)
                .foregroundStyle(WhisperColor.textSecondary)
            }
            .frame(minHeight: 44)

            if supportsThinking {
                LevelCycleButton(systemImage: "brain", label: effectiveThinkingLevel.label, highlightColor: hiveAccent) {
                    thinkingLevel = effectiveThinkingLevel.next(in: thinkingLevels)
                }
            }
            if supportsPlanMode {
                ModeToggle(systemImage: "doc.text", label: "Plan", isActive: $planModeEnabled, highlightColor: hiveAccent)
            }
            if supportsFastMode {
                ModeToggle(systemImage: "bolt.fill", label: "Fast", isActive: $fastModeEnabled, highlightColor: hiveAccent)
            }

            Spacer()

            ContextRingView(usage: contextUsage)
        }
        .padding(.horizontal, 16)
    }

    // MARK: - Attachment Chip Tray

    private var attachmentChipTray: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(attachedImages) { item in
                    AttachmentChip(image: item.image) {
                        withAnimation(.spring(duration: 0.25)) {
                            attachedImages.removeAll { $0.id == item.id }
                        }
                        onDraftAttachmentsChange(attachedImages.map(\.attachment))
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 4)
        }
        .scrollIndicators(.hidden)
        .transition(.move(edge: .top).combined(with: .opacity))
    }

    // MARK: - Compose Area

    private var composeArea: some View {
        HStack(alignment: .bottom, spacing: 8) {
            PhotosPicker(
                selection: $selectedItems,
                maxSelectionCount: 5,
                matching: .images
            ) {
                Image(systemName: "plus")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(WhisperColor.textSecondary)
                    .frame(width: 32, height: 32)
            }

            TextField("Message", text: $draft, axis: .vertical)
                .lineLimit(1...5)
                .submitLabel(.send)
                .onSubmit {
                    if canSend { handleSend() }
                }
                .textFieldStyle(.plain)
                .frame(maxWidth: .infinity, minHeight: 28, alignment: .leading)

            Button {
                handleSend()
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(canSend ? WhisperColor.text : WhisperColor.textMuted)
            }
            .disabled(!canSend)

            if isBusy {
                Button {
                    onStop?()
                } label: {
                    Image(systemName: "stop.circle.fill")
                        .font(.system(size: 28))
                        .foregroundStyle(.red)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    // MARK: - Plan Mode Overlay

    @ViewBuilder
    private var planModeOverlay: some View {
        if planModeEnabled {
            RoundedRectangle(cornerRadius: 20)
                .strokeBorder(
                    hiveAccent.opacity(0.5),
                    style: StrokeStyle(lineWidth: 1, dash: [5, 4])
                )
        }
    }

    // MARK: - Logic

    private var canSend: Bool {
        (!draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachedImages.isEmpty) && !isBusy
    }

    private func handleSend() {
        let imageAttachments = attachedImages.map(\.attachment)
        attachedImages = []
        selectedItems = []
        onDraftAttachmentsChange([])
        onSend(imageAttachments)
    }

    private func loadImages(from items: [PhotosPickerItem]) {
        for item in items {
            item.loadTransferable(type: Data.self) { result in
                if case .success(let data) = result, let data, let uiImage = UIImage(data: data) {
                    guard let attachment = ImageAttachment.makeFromDraftImage(uiImage) else { return }
                    DispatchQueue.main.async {
                        withAnimation(.spring(duration: 0.25)) {
                            attachedImages.append(AttachedImage(image: uiImage, attachment: attachment))
                        }
                        onDraftAttachmentsChange(attachedImages.map(\.attachment))
                    }
                }
            }
        }
    }

    private func restoreAttachedImages(from attachments: [ImageAttachment]) {
        let normalized = attachments.map(\.dataUrl)
        let current = attachedImages.map(\.attachment.dataUrl)
        guard normalized != current else { return }

        attachedImages = attachments.compactMap { attachment in
            guard let uiImage = attachment.decodedImage else { return nil }
            return AttachedImage(image: uiImage, attachment: attachment)
        }
        if attachedImages.count != attachments.count {
            onDraftAttachmentsChange(attachedImages.map(\.attachment))
        }
    }
}

// MARK: - Internal Models

private struct AttachedImage: Identifiable {
    let id = UUID()
    let image: UIImage
    let attachment: ImageAttachment
}

// MARK: - Mode Toggle

private struct ModeToggle: View {
    let systemImage: String
    let label: String
    @Binding var isActive: Bool
    var highlightColor: Color = .white

    var body: some View {
        Button { isActive.toggle() } label: {
            HStack(spacing: 4) {
                Image(systemName: systemImage)
                Text(label)
            }
            .font(.caption)
            .foregroundStyle(isActive ? highlightColor : WhisperColor.textSecondary)
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(
                Capsule().fill(isActive ? highlightColor.opacity(0.15) : .clear)
            )
            .overlay(
                Capsule().stroke(isActive ? highlightColor.opacity(0.3) : .clear, lineWidth: 0.5)
            )
        }
        .frame(minHeight: 44)
    }
}

// MARK: - Level Cycle Button

private struct LevelCycleButton: View {
    let systemImage: String
    let label: String
    var highlightColor: Color = .white
    let action: () -> Void

    var body: some View {
        Button { action() } label: {
            HStack(spacing: 4) {
                Image(systemName: systemImage)
                Text(label)
            }
            .font(.caption)
            .foregroundStyle(highlightColor)
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(
                Capsule().fill(highlightColor.opacity(0.15))
            )
            .overlay(
                Capsule().stroke(highlightColor.opacity(0.3), lineWidth: 0.5)
            )
        }
        .frame(minHeight: 44)
    }
}

// MARK: - Attachment Chip

private struct AttachmentChip: View {
    let image: UIImage
    let onRemove: () -> Void

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(width: 52, height: 52)
                .clipShape(RoundedRectangle(cornerRadius: 8))

            Button {
                onRemove()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 16))
                    .foregroundStyle(.white)
                    .background(WhisperColor.imageControlBg, in: Circle())
            }
            .offset(x: 4, y: -4)
        }
    }
}

// MARK: - UIImage Resizing

private extension UIImage {
    func constrainedTo(maxDimension: CGFloat) -> UIImage {
        let longest = max(size.width, size.height)
        guard longest > maxDimension else { return self }
        let scale = maxDimension / longest
        let newSize = CGSize(width: size.width * scale, height: size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: newSize)
        return renderer.image { _ in draw(in: CGRect(origin: .zero, size: newSize)) }
    }
}

private extension ImageAttachment {
    static func makeFromDraftImage(_ image: UIImage) -> ImageAttachment? {
        let resized = image.constrainedTo(maxDimension: 1536)
        guard let data = resized.jpegData(compressionQuality: 0.7) else { return nil }
        return .init(
            name: "image.jpg",
            mediaType: "image/jpeg",
            dataUrl: "data:image/jpeg;base64,\(data.base64EncodedString())"
        )
    }

    var decodedImage: UIImage? {
        let payload: String
        if let commaIndex = dataUrl.firstIndex(of: ",") {
            payload = String(dataUrl[dataUrl.index(after: commaIndex)...])
        } else {
            payload = dataUrl
        }
        guard let data = Data(base64Encoded: payload) else { return nil }
        return UIImage(data: data)
    }
}

// MARK: - Preview

#Preview {
    let sampleModels: [ModelCatalogEntry] = [
        .init(id: "claude:opus-4-7", label: "Opus 4.7", provider: "claude", providerLabel: "Claude Code",
              isDefault: true, isNew: nil,
              capabilities: .init(thinkingLevels: [.low, .medium, .high, .xhigh, .max], planMode: true, blockingTools: true, completions: true, goals: false),
              contextWindow: 1_000_000, supportsFastMode: true),
        .init(id: "claude:sonnet-4-6", label: "Sonnet 4.6", provider: "claude", providerLabel: "Claude Code",
              isDefault: nil, isNew: true,
              capabilities: .init(thinkingLevels: [.low, .medium, .high, .xhigh, .max], planMode: true, blockingTools: true, completions: true, goals: false),
              contextWindow: 1_000_000, supportsFastMode: nil),
    ]
    let grouped = [ModelProviderGroup(provider: "claude", providerLabel: "Claude Code", models: sampleModels)]

    VStack {
        Spacer()
        ChatInputBar(
            draft: .constant("Hello"),
            draftAttachments: [],
            isBusy: false,
            planModeEnabled: .constant(false),
            thinkingLevel: .constant(.high),
            fastModeEnabled: .constant(false),
            models: sampleModels,
            groupedModels: grouped,
            selectedModelId: "claude:opus-4-7",
            defaultModelId: "claude:opus-4-7",
            lockedProvider: nil,
            capabilities: .init(thinkingLevels: [.low, .medium, .high, .xhigh, .max], planMode: true, blockingTools: true, completions: true, goals: false),
            onModelSelect: { _ in },
            contextUsage: ContextUsageData(inputTokens: 62_000, contextWindow: 200_000),
            onDraftAttachmentsChange: { _ in },
            onSend: { _ in }
        )
        ChatInputBar(
            draft: .constant(""),
            draftAttachments: [],
            isBusy: true,
            planModeEnabled: .constant(true),
            thinkingLevel: .constant(.low),
            fastModeEnabled: .constant(true),
            models: sampleModels,
            groupedModels: grouped,
            selectedModelId: "claude:sonnet-4-6",
            defaultModelId: "claude:opus-4-7",
            lockedProvider: "claude",
            capabilities: .init(thinkingLevels: [.low, .medium, .high, .xhigh, .max], planMode: true, blockingTools: true, completions: true, goals: false),
            onModelSelect: { _ in },
            contextUsage: ContextUsageData(inputTokens: 170_000, contextWindow: 200_000),
            onDraftAttachmentsChange: { _ in },
            onSend: { _ in },
            onStop: {}
        )
    }
    .padding()
    .preferredColorScheme(.dark)
}
