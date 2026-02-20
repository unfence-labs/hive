import PhotosUI
import SwiftUI

struct ChatInputBar: View {
    @Binding var draft: String
    let draftAttachments: [ImageAttachment]
    let isBusy: Bool
    @Binding var thinkingEnabled: Bool
    @Binding var planModeEnabled: Bool
    @Binding var selectedModel: ClaudeModel
    let onDraftAttachmentsChange: ([ImageAttachment]) -> Void
    let onSend: ([ImageAttachment]) -> Void
    var onStop: (() -> Void)?

    @AppStorage("hiveAccent") private var accentId = "violet"
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
                .foregroundStyle(.secondary.opacity(0.2))

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

    private var controlBar: some View {
        HStack(spacing: 8) {
            // Model picker
            Menu {
                ForEach(ClaudeModel.allCases) { model in
                    Button {
                        selectedModel = model
                    } label: {
                        if model == selectedModel {
                            Label(model.label, systemImage: "checkmark")
                        } else {
                            Text(model.label)
                        }
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "sparkles")
                    Text(selectedModel.label)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 8))
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            .frame(minHeight: 44)

            ModeToggle(systemImage: "brain", label: "Thinking", isActive: $thinkingEnabled, highlightColor: hiveAccent)
            ModeToggle(systemImage: "doc.text", label: "Plan", isActive: $planModeEnabled, highlightColor: hiveAccent)

            Spacer()
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
                    .foregroundStyle(.secondary)
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
                    .foregroundStyle(canSend ? .primary : .tertiary)
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
            .foregroundStyle(isActive ? highlightColor : .secondary)
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
                    .background(Color.black.opacity(0.6), in: Circle())
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
    VStack {
        Spacer()
        ChatInputBar(
            draft: .constant("Hello"),
            draftAttachments: [],
            isBusy: false,
            thinkingEnabled: .constant(true),
            planModeEnabled: .constant(false),
            selectedModel: .constant(.opus),
            onDraftAttachmentsChange: { _ in },
            onSend: { _ in }
        )
        ChatInputBar(
            draft: .constant(""),
            draftAttachments: [],
            isBusy: true,
            thinkingEnabled: .constant(false),
            planModeEnabled: .constant(true),
            selectedModel: .constant(.sonnet),
            onDraftAttachmentsChange: { _ in },
            onSend: { _ in },
            onStop: {}
        )
    }
    .padding()
    .preferredColorScheme(.dark)
}
