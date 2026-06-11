import SwiftUI

private let outsideWorkspaceMessage = "Image is outside the workspace and cannot be previewed."

/// `image_view` activity: a "View image" toggle with the thumbnail below.
/// Mirrors `ImageViewActivity` in `frontend/src/components/chat/ImageActivity.tsx`.
struct ImageViewActivityRow: View {
    let activity: AgentActivity.ImageView

    private var name: String { imageActivityFileName(activity.path) }
    private var source: String? { activity.resolvedSource }

    private var expandedContent: AnyView? {
        if activity.outsideWorkspace == true {
            return AnyView(ImageActivityBodyText(outsideWorkspaceMessage))
        }
        return source == nil ? AnyView(ImageActivityBodyText(activity.path)) : nil
    }

    var body: some View {
        ImageActivityShell(
            title: "View image",
            detail: name,
            source: source,
            noPreviewMessage: activity.outsideWorkspace == true ? outsideWorkspaceMessage : nil,
            expanded: expandedContent
        )
    }
}

/// `image_generation` activity: a "Proposed image" toggle with the revised
/// prompt and a thumbnail below that animates while the turn is generating.
/// Mirrors `ImageGenerationActivity`.
struct ImageGenerationActivityRow: View {
    let activity: AgentActivity.ImageGeneration
    var showExecutingState = false

    private var source: String? { activity.resolvedSource }
    private var pending: Bool { activity.isPending(showExecutingState: showExecutingState) }
    private var promptDetail: String? { imagePromptPreview(activity.revisedPrompt) }

    private var expandedContent: AnyView? {
        guard let prompt = activity.revisedPrompt, !prompt.isEmpty else { return nil }
        return AnyView(ImageActivityBodyText(prompt))
    }

    var body: some View {
        ImageActivityShell(
            title: "Proposed image",
            detail: promptDetail,
            source: source,
            executing: pending,
            expanded: expandedContent
        )
    }
}

private struct ImageActivityShell: View {
    private static let tileSize = CGSize(width: 80, height: 80)

    let title: String
    var detail: String?
    let source: String?
    var executing = false
    var noPreviewMessage: String?
    var expanded: AnyView?

    var body: some View {
        ActivityDisclosureRow(
            icon: "photo",
            title: title,
            detail: detail,
            executing: executing,
            expanded: expanded,
            below: AnyView(
                ChatImageTileWithLightbox(
                    source: source,
                    pending: executing,
                    size: Self.tileSize,
                    noPreviewMessage: noPreviewMessage
                )
                .padding(.top, 6)
            )
        )
    }
}

private struct ImageActivityBodyText: View {
    let text: String

    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text)
            .font(.system(size: 12))
            .foregroundStyle(WhisperColor.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
