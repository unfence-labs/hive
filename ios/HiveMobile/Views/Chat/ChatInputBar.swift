import PhotosUI
import SwiftUI

struct ChatInputBar: View {
    @Binding var draft: String
    let draftAttachments: [ImageAttachment]
    let isBusy: Bool
    @Binding var planModeEnabled: Bool
    @Binding var thinkingLevel: ThinkingLevel
    @Binding var fastModeEnabled: Bool
    @Binding var outputStyle: OutputStyle
    let isOutputStyleLocked: Bool
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var attachedImages: [AttachedImage] = []
    @State private var selectedItems: [PhotosPickerItem] = []
    @State private var showAttachmentError = false
    @State private var showModelMenu = false
    @State private var showEffortMenu = false

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

            if showAttachmentError {
                attachmentErrorBanner
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


    /// When a session is locked to a provider, only that provider's models are
    /// selectable, so show just those rather than greying the rest out.
    private var selectableModelGroups: [ModelProviderGroup] {
        guard let lockedProvider else { return groupedModels }
        return groupedModels.filter { $0.provider == lockedProvider }
    }

    private var lockedProviderLabel: String? {
        guard lockedProvider != nil else { return nil }
        return selectableModelGroups.first?.providerLabel
    }

    private var thinkingLevels: [ThinkingLevel] { capabilities?.thinkingLevels ?? [] }
    private var supportsThinking: Bool { !thinkingLevels.isEmpty }
    private var outputStyles: [OutputStyle] { capabilities?.outputStyles ?? [] }
    private var effectiveOutputStyle: OutputStyle? { outputStyle.resolved(in: outputStyles) }
    private var supportsPlanMode: Bool { capabilities?.planMode ?? true }
    /// Fast mode is gated per-model (Opus-only), not by provider capabilities.
    private var supportsFastMode: Bool {
        models.first { $0.id == selectedModelId }?.supportsFastMode ?? false
    }

    private var selectedProvider: String? {
        models.first { $0.id == selectedModelId }?.provider
    }

    /// Whether any model of the selected provider supports fast mode; gates the Fast row.
    private var providerHasFastMode: Bool {
        guard let selectedProvider else { return false }
        return models.contains { $0.provider == selectedProvider && $0.supportsFastMode == true }
    }

    private var isOptionsMenuActive: Bool {
        if let effectiveOutputStyle, effectiveOutputStyle != .default { return true }
        return supportsFastMode && fastModeEnabled
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
            Button {
                showModelMenu = true
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "sparkles")
                    Text(selectedModelLabel)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 8))
                }
                .font(.caption)
                .foregroundStyle(WhisperColor.textSecondary)
                .fixedSize()
            }
            .frame(minHeight: 44)
            .popover(isPresented: $showModelMenu, attachmentAnchor: .rect(.bounds), arrowEdge: .bottom) {
                ModelMenu(
                    groups: selectableModelGroups,
                    selectedModelId: selectedModelId,
                    accent: hiveAccent,
                    lockedProviderLabel: lockedProviderLabel
                ) { id in
                    Haptics.selection()
                    onModelSelect(id)
                    showModelMenu = false
                }
                .presentationCompactAdaptation(.popover)
            }

            if supportsThinking {
                ControlMenuButton(systemImage: "brain", label: effectiveThinkingLevel.label, highlightColor: hiveAccent) {
                    showEffortMenu = true
                }
                .popover(isPresented: $showEffortMenu, attachmentAnchor: .rect(.bounds), arrowEdge: .bottom) {
                    SelectionMenu(
                        options: Array(thinkingLevels.reversed()),
                        selectedOption: effectiveThinkingLevel,
                        accent: hiveAccent,
                        label: \ThinkingLevel.label
                    ) { level in
                        Haptics.selection()
                        thinkingLevel = level
                        showEffortMenu = false
                    }
                    .presentationCompactAdaptation(.popover)
                }
            }
            if supportsPlanMode {
                ModeToggle(systemImage: "doc.text", label: "Plan", isActive: $planModeEnabled, highlightColor: hiveAccent)
            }
            if effectiveOutputStyle != nil || providerHasFastMode {
                optionsMenu
            }

            Spacer()

            ContextRingView(usage: contextUsage)
        }
        .padding(.horizontal, 16)
    }

    /// Overflow menu grouping the output style picker and the fast mode toggle.
    private var optionsMenu: some View {
        Menu {
            if let effectiveOutputStyle {
                Menu {
                    ForEach(outputStyles, id: \.self) { style in
                        Button {
                            Haptics.selection()
                            outputStyle = style
                        } label: {
                            if style == effectiveOutputStyle {
                                Label(style.label, systemImage: "checkmark")
                            } else {
                                Text(style.label)
                            }
                        }
                    }
                } label: {
                    Text("Output")
                    Text(effectiveOutputStyle.label)
                }
                .disabled(isOutputStyleLocked)
            }
            if providerHasFastMode {
                Button {
                    Haptics.selection()
                    fastModeEnabled.toggle()
                } label: {
                    if supportsFastMode && fastModeEnabled {
                        Label("Fast mode", systemImage: "checkmark")
                    } else if supportsFastMode {
                        Text("Fast mode")
                    } else {
                        Text("Fast mode")
                        Text("Opus only")
                    }
                }
                .disabled(!supportsFastMode)
            }
        } label: {
            Image(systemName: "slider.horizontal.3")
                .font(.caption)
                .foregroundStyle(isOptionsMenuActive ? hiveAccent : WhisperColor.textSecondary)
        }
        .frame(minHeight: 44)
        .accessibilityLabel("More options")
    }

    // MARK: - Attachment Chip Tray

    private var attachmentChipTray: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(attachedImages) { item in
                    AttachmentChip(source: item.attachment?.dataUrl, pending: item.attachment == nil) {
                        animateAttachment {
                            attachedImages.removeAll { $0.id == item.id }
                        }
                        onDraftAttachmentsChange(attachedImages.compactMap(\.attachment))
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 4)
        }
        .scrollIndicators(.hidden)
        .transition(.move(edge: .top).combined(with: .opacity))
    }

    private var attachmentErrorBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(WhisperColor.warning)
            Text("Image could not be attached.")
                .foregroundStyle(WhisperColor.textSecondary)
            Spacer()
            Button {
                withAnimation(.spring(duration: 0.25)) {
                    showAttachmentError = false
                }
            } label: {
                Image(systemName: "xmark")
                    .foregroundStyle(WhisperColor.textMuted)
                    .frame(width: 44, height: 32)
            }
            .accessibilityLabel("Dismiss")
        }
        .font(.caption)
        .padding(.horizontal, 16)
        .padding(.vertical, 4)
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
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("Attach image")

            TextField("Message", text: $draft, axis: .vertical)
                .lineLimit(1...10)
                .textFieldStyle(.plain)
                .frame(maxWidth: .infinity, minHeight: 28, alignment: .leading)

            Button {
                handleSend()
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(canSend ? WhisperColor.text : WhisperColor.textMuted)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .disabled(!canSend)
            .accessibilityLabel("Send message")

            if isBusy {
                Button {
                    Haptics.impact(.light)
                    onStop?()
                } label: {
                    Image(systemName: "stop.circle.fill")
                        .font(.system(size: 28))
                        .foregroundStyle(.red)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel("Stop response")
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
        let hasPending = attachedImages.contains { $0.attachment == nil }
        let hasContent = !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachedImages.isEmpty
        return hasContent && !hasPending && !isBusy
    }

    private func animateAttachment(_ body: () -> Void) {
        if reduceMotion { body() } else { withAnimation(.spring(duration: 0.25), body) }
    }

    private func handleSend() {
        Haptics.impact(.light)
        let imageAttachments = attachedImages.compactMap(\.attachment)
        attachedImages = []
        onDraftAttachmentsChange([])
        onSend(imageAttachments)
    }

    private func loadImages(from items: [PhotosPickerItem]) {
        guard !items.isEmpty else { return }
        selectedItems = []
        showAttachmentError = false
        for item in items {
            let pending = AttachedImage(attachment: nil)
            animateAttachment {
                attachedImages.append(pending)
            }
            item.loadTransferable(type: Data.self) { result in
                DispatchQueue.main.async {
                    guard let index = attachedImages.firstIndex(where: { $0.id == pending.id }) else { return }
                    if case .success(let data) = result, let data,
                       let uiImage = UIImage(data: data),
                       let attachment = ImageAttachment.makeFromDraftImage(uiImage) {
                        let isDuplicate = attachedImages.contains {
                            $0.id != pending.id && $0.attachment?.dataUrl == attachment.dataUrl
                        }
                        if isDuplicate {
                            animateAttachment {
                                attachedImages.removeAll { $0.id == pending.id }
                            }
                        } else {
                            attachedImages[index].attachment = attachment
                            onDraftAttachmentsChange(attachedImages.compactMap(\.attachment))
                        }
                    } else {
                        animateAttachment {
                            attachedImages.remove(at: index)
                            showAttachmentError = true
                        }
                    }
                }
            }
        }
    }

    private func restoreAttachedImages(from attachments: [ImageAttachment]) {
        let normalized = attachments.map(\.dataUrl)
        let current = attachedImages.compactMap { $0.attachment?.dataUrl }
        guard normalized != current else { return }

        let restored: [AttachedImage] = attachments.compactMap { attachment in
            guard attachment.hasDecodableImagePayload else { return nil }
            return AttachedImage(attachment: attachment)
        }
        attachedImages = restored + attachedImages.filter { $0.attachment == nil }
        if restored.count != attachments.count {
            onDraftAttachmentsChange(attachedImages.compactMap(\.attachment))
        }
    }
}

// MARK: - Internal Models

private struct AttachedImage: Identifiable {
    let id = UUID()
    var attachment: ImageAttachment?
}

// MARK: - Mode Toggle

private struct ModelMenu: View {
    let groups: [ModelProviderGroup]
    let selectedModelId: String
    let accent: Color
    var lockedProviderLabel: String? = nil
    let onSelect: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            ForEach(Array(groups.enumerated()), id: \.element.id) { index, group in
                if index > 0 {
                    Divider().padding(.vertical, 5)
                }
                Text(group.providerLabel)
                    .font(.caption2)
                    .foregroundStyle(WhisperColor.textMuted)
                    .padding(.horizontal, 14)
                    .padding(.top, index == 0 ? 12 : 0)
                    .padding(.bottom, 3)
                ForEach(group.models) { model in
                    Button {
                        onSelect(model.id)
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "checkmark")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(accent)
                                .opacity(model.id == selectedModelId ? 1 : 0)
                                .frame(width: 15)
                            Text(model.label)
                                .foregroundStyle(.primary)
                            Spacer(minLength: 8)
                        }
                        .font(.subheadline)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 9)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            if let lockedProviderLabel {
                Divider().padding(.vertical, 5)
                Text("This conversation continues with \(lockedProviderLabel).")
                    .font(.caption2)
                    .foregroundStyle(WhisperColor.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 14)
                    .padding(.bottom, 8)
            }
        }
        .padding(.vertical, 5)
        .frame(width: 234)
        .fixedSize(horizontal: false, vertical: true)
    }
}

private struct SelectionMenu<Option: Hashable>: View {
    let options: [Option]
    let selectedOption: Option
    let accent: Color
    let label: KeyPath<Option, String>
    let onSelect: (Option) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            ForEach(options, id: \.self) { option in
                Button {
                    onSelect(option)
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "checkmark")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(accent)
                            .opacity(option == selectedOption ? 1 : 0)
                            .frame(width: 15)
                        Text(option[keyPath: label])
                            .foregroundStyle(.primary)
                        Spacer(minLength: 8)
                    }
                    .font(.subheadline)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 5)
        .frame(width: 180)
        .fixedSize(horizontal: false, vertical: true)
    }
}

private struct ModeToggle: View {
    let systemImage: String
    let label: String
    @Binding var isActive: Bool
    var highlightColor: Color = .white

    var body: some View {
        Button {
            Haptics.selection()
            isActive.toggle()
        } label: {
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

// MARK: - Control Menu Button

private struct ControlMenuButton: View {
    let systemImage: String
    let label: String
    var highlightColor: Color = .white
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            HStack(spacing: 4) {
                Image(systemName: systemImage)
                Text(label)
                    .lineLimit(1)
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
    private static let size = CGSize(width: 52, height: 52)

    let source: String?
    let pending: Bool
    let onRemove: () -> Void

    var body: some View {
        ZStack(alignment: .topTrailing) {
            ChatImageTile(
                source: source,
                pending: pending,
                size: Self.size,
                cornerRadius: 8
            )

            Button {
                onRemove()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 18))
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, .black.opacity(0.55))
            }
            .accessibilityLabel("Remove image")
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

    var hasDecodableImagePayload: Bool {
        let payload: String
        if let commaIndex = dataUrl.firstIndex(of: ",") {
            payload = String(dataUrl[dataUrl.index(after: commaIndex)...])
        } else {
            payload = dataUrl
        }
        return Data(base64Encoded: payload) != nil
    }
}

// MARK: - Preview

#Preview {
    let sampleModels: [ModelCatalogEntry] = [
        .init(id: "claude:opus-4-7", label: "Opus 4.7", provider: "claude", providerLabel: "Claude Code",
              isDefault: true,
              capabilities: .init(thinkingLevels: [.low, .medium, .high, .xhigh, .max], outputStyles: [.default, .proactive, .concise, .explanatory, .learning], planMode: true, blockingTools: true, completions: true, goals: false),
              contextWindow: 1_000_000, supportsFastMode: true),
        .init(id: "claude:sonnet-4-6", label: "Sonnet 4.6", provider: "claude", providerLabel: "Claude Code",
              isDefault: nil,
              capabilities: .init(thinkingLevels: [.low, .medium, .high, .xhigh, .max], outputStyles: [.default, .proactive, .concise, .explanatory, .learning], planMode: true, blockingTools: true, completions: true, goals: false),
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
            outputStyle: .constant(.default),
            isOutputStyleLocked: false,
            models: sampleModels,
            groupedModels: grouped,
            selectedModelId: "claude:opus-4-7",
            defaultModelId: "claude:opus-4-7",
            lockedProvider: nil,
            capabilities: .init(thinkingLevels: [.low, .medium, .high, .xhigh, .max], outputStyles: [.default, .proactive, .concise, .explanatory, .learning], planMode: true, blockingTools: true, completions: true, goals: false),
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
            outputStyle: .constant(.explanatory),
            isOutputStyleLocked: true,
            models: sampleModels,
            groupedModels: grouped,
            selectedModelId: "claude:sonnet-4-6",
            defaultModelId: "claude:opus-4-7",
            lockedProvider: "claude",
            capabilities: .init(thinkingLevels: [.low, .medium, .high, .xhigh, .max], outputStyles: [.default, .proactive, .concise, .explanatory, .learning], planMode: true, blockingTools: true, completions: true, goals: false),
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
