import SwiftUI

struct WorkspaceDiffDestination: Hashable {
    let workspace: Workspace
    let scope: String
}

struct WorkspaceFileDiffDestination: Hashable {
    let workspace: Workspace
    let scope: String
    let paths: [String]
    let index: Int
}

struct ChangedFilesView: View {
    let workspace: Workspace
    let scope: String
    @Binding var navigationPath: NavigationPath

    @Environment(ProjectStore.self) private var projectStore

    private var files: [DiffFileStat] {
        guard let stats = projectStore.statusMonitor.diffStats(for: workspace.id) else { return [] }
        return scope == "committed" ? stats.committed : stats.uncommitted
    }

    private var isLoaded: Bool {
        projectStore.statusMonitor.diffStats(for: workspace.id) != nil
    }

    var body: some View {
        List {
            ForEach(Array(files.enumerated()), id: \.element.id) { index, file in
                Button {
                    navigationPath.append(WorkspaceFileDiffDestination(
                        workspace: workspace,
                        scope: scope,
                        paths: files.map(\.file),
                        index: index
                    ))
                } label: {
                    ChangedFileRow(file: file)
                }
                .listRowBackground(WhisperColor.surfaceRaised)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .hiveScreenBackground()
        .navigationTitle(scope == "committed" ? "Branch commits" : "Working tree")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { projectStore.statusMonitor.forceRefresh() }
        .overlay {
            if !isLoaded {
                ListLoadingSkeleton()
            } else if files.isEmpty {
                ContentUnavailableView(
                    "No changes",
                    systemImage: "checkmark.circle",
                    description: Text("Nothing to review in this scope.")
                )
            }
        }
    }
}

private struct ChangedFileRow: View {
    let file: DiffFileStat

    private var fileName: String { (file.file as NSString).lastPathComponent }
    private var directory: String { (file.file as NSString).deletingLastPathComponent }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.body)
                .foregroundStyle(iconColor)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 1) {
                Text(fileName)
                    .font(WhisperFont.scaled(15, weight: .medium))
                    .foregroundStyle(WhisperColor.text)
                    .lineLimit(1)
                if !directory.isEmpty {
                    Text(directory)
                        .font(WhisperFont.scaled(12))
                        .foregroundStyle(WhisperColor.textMuted)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            Spacer(minLength: 8)
            if file.additions > 0 {
                Text("+\(file.additions)")
                    .foregroundStyle(.green)
            }
            if file.deletions > 0 {
                Text("-\(file.deletions)")
                    .foregroundStyle(.red)
            }
            Image(systemName: "chevron.right")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(WhisperColor.textMuted)
        }
        .font(WhisperFont.mono(11))
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }

    private var icon: String {
        switch file.status {
        case .added: "plus.circle"
        case .deleted: "minus.circle"
        case .renamed: "arrow.right.circle"
        case .modified: "pencil.circle"
        }
    }

    private var iconColor: Color {
        switch file.status {
        case .added: .green
        case .deleted: .red
        case .renamed: .orange
        case .modified: WhisperColor.textSecondary
        }
    }
}

struct WorkspaceFileDiffView: View {
    let workspace: Workspace
    let scope: String
    let paths: [String]
    @Binding var navigationPath: NavigationPath

    @State var index: Int
    @State private var scrolledPage: Int?
    @State private var filesByPath: [String: WorkspaceFileDiff]?
    @State private var omittedFileCount = 0
    @State private var loadFailed = false
    @State private var preparingFix = false
    @State private var sendFailed = false
    @State private var pendingComments: [DiffComment] = []
    @State private var draftComment: DiffComment?
    @State private var scrollTarget: UUID?

    private let api = APIClient()
    private let draftStore = ChatDraftStore.shared

    var body: some View {
        ScrollView(.horizontal) {
            LazyHStack(spacing: 0) {
                ForEach(Array(paths.enumerated()), id: \.offset) { i, path in
                    filePage(path: path)
                        .containerRelativeFrame(.horizontal)
                        .id(i)
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.paging)
        .scrollPosition(id: $scrolledPage)
        .scrollIndicators(.hidden)
        .onAppear { scrolledPage = index }
        .onChange(of: scrolledPage) { _, page in
            if let page { index = page }
        }
        .hiveScreenBackground()
        .navigationTitle((paths[index] as NSString).lastPathComponent)
        .navigationSubtitle(Text("\(index + 1) of \(paths.count)"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    sendToChat()
                } label: {
                    if preparingFix {
                        ProgressView()
                    } else if pendingComments.isEmpty {
                        Label("Ask for a fix", systemImage: "bubble.and.pencil")
                    } else {
                        Label("Send review", systemImage: "paperplane.fill")
                            .labelStyle(.titleAndIcon)
                    }
                }
                .disabled(preparingFix)
            }
        }
        .safeAreaInset(edge: .bottom) {
            if !pendingComments.isEmpty {
                ReviewSummaryBar(count: pendingComments.count, onJump: jumpToComment) {
                    sendToChat()
                }
            }
        }
        .sheet(item: $draftComment) { draft in
            DiffCommentSheet(comment: draft) { finished in
                pendingComments.append(finished)
                draftComment = nil
            }
        }
        .alert("Couldn't send to chat", isPresented: $sendFailed) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("No agent session is available for this workspace. Check your connection and try again.")
        }
        .task { await loadDiff() }
    }

    @ViewBuilder
    private func filePage(path: String) -> some View {
        if let filesByPath {
            if let file = filesByPath[path] {
                if file.isBinary {
                    ContentUnavailableView("Binary file changed", systemImage: "doc.zipper")
                } else {
                    ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 0) {
                            fileHeader(file)
                            Divider()
                            let segments = segmentDiffLines(
                                parseUnifiedDiffLines(file.text, includeHunkMarkers: true),
                                comments: pendingComments.filter { $0.file == file.path }
                            )
                            VStack(alignment: .leading, spacing: 0) {
                                ForEach(segments) { segment in
                                    SelectableDiffText(
                                        lines: segment.lines,
                                        onTapLine: { line in
                                            draftComment = DiffComment(file: file.path, line: line.text, snippet: nil, text: "")
                                        },
                                        onCommentSelection: { line, snippet in
                                            draftComment = DiffComment(file: file.path, line: line.text, snippet: snippet, text: "")
                                        }
                                    )
                                    ForEach(segment.comments) { comment in
                                        InlineCommentCard(comment: comment) {
                                            pendingComments.removeAll { $0.id == comment.id }
                                        }
                                        .id(comment.id)
                                    }
                                }
                            }
                            .padding(.vertical, 8)
                            .background(WhisperColor.codeBlockBg)
                        }
                        .background(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .fill(WhisperColor.surfaceRaised)
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .stroke(WhisperColor.borderSubtle, lineWidth: 1)
                        )
                        .padding(.horizontal, HiveSpacing.md)
                        .padding(.vertical, HiveSpacing.sm)
                    }
                    .onChange(of: scrollTarget) { _, target in
                        guard let target, pendingComments.first(where: { $0.id == target })?.file == file.path else { return }
                        withAnimation { proxy.scrollTo(target, anchor: .center) }
                    }
                    }
                }
            } else if omittedFileCount > 0 {
                ContentUnavailableView(
                    "Not included in this preview",
                    systemImage: "doc.badge.ellipsis",
                    description: Text(omittedFileCount == 1
                        ? "1 untracked file was omitted from the rendered diff. This file may be one of them."
                        : "\(omittedFileCount) untracked files were omitted from the rendered diff. This file may be one of them.")
                )
            } else {
                ContentUnavailableView("No diff for this file", systemImage: "doc")
            }
        } else if loadFailed {
            ContentUnavailableView {
                Label("Couldn't load the diff", systemImage: "wifi.exclamationmark")
            } actions: {
                Button("Retry") { Task { await loadDiff() } }
            }
        } else {
            ProgressView()
        }
    }

    @ViewBuilder
    private func fileHeader(_ file: WorkspaceFileDiff) -> some View {
        let stats = parseDiffStats(file.text)
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 8) {
                Image(systemName: "doc.text")
                    .font(.footnote)
                    .foregroundStyle(WhisperColor.textMuted)
                Text("\(Text(directoryPrefix(file.path)).foregroundColor(WhisperColor.textMuted))\(Text((file.path as NSString).lastPathComponent).fontWeight(.semibold))")
                    .foregroundStyle(WhisperColor.text)
                    .font(WhisperFont.scaled(13))
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 8)
                if stats.added > 0 {
                    Text("+\(stats.added)").foregroundStyle(.green)
                }
                if stats.removed > 0 {
                    Text("-\(stats.removed)").foregroundStyle(.red)
                }
            }
            .font(WhisperFont.mono(11))
            if let renamedFrom = file.renamedFrom {
                Text("Renamed from \(renamedFrom)")
                    .font(WhisperFont.mono(10))
                    .foregroundStyle(WhisperColor.textMuted)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    private func directoryPrefix(_ path: String) -> String {
        let dir = (path as NSString).deletingLastPathComponent
        return dir.isEmpty ? "" : dir + "/"
    }

    private func loadDiff() async {
        loadFailed = false
        do {
            let response = try await api.fetchWorkspaceDiff(workspaceId: workspace.id, scope: scope)
            omittedFileCount = response.omittedFileCount
            filesByPath = Dictionary(
                splitUnifiedDiff(response.diff).map { ($0.path, $0) },
                uniquingKeysWith: { first, _ in first }
            )
        } catch {
            loadFailed = true
        }
    }

    private func sendToChat() {
        preparingFix = true
        Task {
            defer { preparingFix = false }
            let sessions = (try? await api.fetchSessions(workspaceId: workspace.id)) ?? []
            guard let target = sessions.first(where: { $0.kind != "terminal" }) else {
                sendFailed = true
                return
            }
            let text = pendingComments.isEmpty
                ? "About `\(paths[index])`: "
                : compiledReview()
            let existing = draftStore.restore(workspaceId: workspace.id, sessionId: target.sessionId)
            let prefix = (existing?.text.isEmpty ?? true) ? "" : existing!.text + "\n"
            draftStore.save(
                workspaceId: workspace.id,
                sessionId: target.sessionId,
                draft: .init(text: prefix + text, attachments: existing?.attachments ?? [])
            )
            navigationPath.removeLast(2)
            navigationPath.append(target)
        }
    }

    @State private var jumpIndex = 0

    private func jumpToComment(_ direction: Int) {
        guard !pendingComments.isEmpty else { return }
        jumpIndex = ((jumpIndex + direction) % pendingComments.count + pendingComments.count) % pendingComments.count
        let comment = pendingComments[jumpIndex]
        if let page = paths.firstIndex(of: comment.file), page != index {
            withAnimation { scrolledPage = page }
        }
        Task {
            try? await Task.sleep(for: .milliseconds(350))
            scrollTarget = nil
            scrollTarget = comment.id
        }
    }

    private func compiledReview() -> String {
        var sections: [String] = ["Review comments on the current diff:"]
        for comment in pendingComments {
            let quoted = (comment.snippet ?? comment.line).trimmingCharacters(in: .whitespacesAndNewlines)
            sections.append("`\(comment.file)`\n> \(quoted.replacingOccurrences(of: "\n", with: "\n> "))\n\(comment.text)")
        }
        return sections.joined(separator: "\n\n")
    }
}

private struct InlineCommentCard: View {
    let comment: DiffComment
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "person.crop.circle.fill")
                    .font(.footnote)
                    .foregroundStyle(WhisperColor.textMuted)
                Text("You")
                    .font(WhisperFont.scaled(12, weight: .semibold))
                    .foregroundStyle(WhisperColor.text)
                Text("· pending")
                    .font(WhisperFont.scaled(12))
                    .foregroundStyle(WhisperColor.textMuted)
                Spacer()
                Button {
                    onDelete()
                } label: {
                    Image(systemName: "xmark")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(WhisperColor.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Delete comment")
            }
            Text(comment.text)
                .font(WhisperFont.scaled(13))
                .foregroundStyle(WhisperColor.text)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(10)
        .background(WhisperColor.surfaceSubtle, in: RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(WhisperColor.border, lineWidth: 1)
        )
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
    }
}

private struct ReviewSummaryBar: View {
    let count: Int
    let onJump: (Int) -> Void
    let onSend: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "text.bubble")
                .foregroundStyle(WhisperColor.textSecondary)
            Text(count == 1 ? "1 comment" : "\(count) comments")
                .font(WhisperFont.scaled(13, weight: .medium))
                .foregroundStyle(WhisperColor.text)
            Button { onJump(-1) } label: {
                Image(systemName: "chevron.up")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(WhisperColor.textSecondary)
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
            Button { onJump(1) } label: {
                Image(systemName: "chevron.down")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(WhisperColor.textSecondary)
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
            Spacer()
            Button("Send review", action: onSend)
                .font(WhisperFont.scaled(13, weight: .semibold))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .glassPill()
        .padding(.horizontal, HiveSpacing.md)
        .padding(.bottom, HiveSpacing.sm)
    }
}

private struct DiffCommentSheet: View {
    @State var comment: DiffComment
    let onAdd: (DiffComment) -> Void

    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                Text((comment.snippet ?? comment.line).trimmingCharacters(in: .whitespacesAndNewlines))
                    .font(WhisperFont.mono(11))
                    .foregroundStyle(WhisperColor.textSecondary)
                    .lineLimit(3)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(WhisperColor.surfaceSubtle, in: RoundedRectangle(cornerRadius: 8))

                TextField("Your comment…", text: $comment.text, axis: .vertical)
                    .lineLimit(3...8)
                    .focused($focused)
                    .textFieldStyle(.plain)
                    .padding(10)
                    .background(WhisperColor.surfaceRaised, in: RoundedRectangle(cornerRadius: 8))

                Spacer()
            }
            .padding(HiveSpacing.md)
            .hiveScreenBackground()
            .navigationTitle((comment.file as NSString).lastPathComponent)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { onAdd(comment) }
                        .disabled(comment.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .onAppear { focused = true }
        }
        .presentationDetents([.medium])
    }
}
