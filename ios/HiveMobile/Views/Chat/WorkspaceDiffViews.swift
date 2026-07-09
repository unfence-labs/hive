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

    private let api = APIClient()

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
        .refreshable {
            if let stats = try? await api.fetchWorkspaceDiffStat(workspaceId: workspace.id) {
                projectStore.statusMonitor.didReceiveDiffStats(stats, for: workspace.id)
            }
        }
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

    @Environment(ProjectStore.self) private var projectStore

    @State var index: Int
    @State private var scrolledPage: PageID?
    @State private var pagerWidth: CGFloat = 0
    @State private var resnapTask: Task<Void, Never>?
    @State private var filesByPath: [String: ParsedFileDiff]?
    @State private var omittedFileCount = 0
    @State private var loadFailed = false
    @State private var preparingFix = false
    @State private var sendFailed = false
    @State private var pendingComments: [DiffComment] = []
    @State private var draftComment: DiffComment?
    @State private var scrollRequest: CommentScrollRequest?

    private let api = APIClient()
    private let draftStore = ChatDraftStore.shared

    var body: some View {
        ScrollViewReader { pagerProxy in
            ScrollView(.horizontal) {
                LazyHStack(spacing: 60) {
                    ForEach(Array(paths.enumerated()), id: \.offset) { i, path in
                        filePage(path: path)
                            .containerRelativeFrame(.horizontal)
                            .id(PageID(index: i))
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.viewAligned)
            .scrollPosition(id: $scrolledPage, anchor: .leading)
            .onGeometryChange(for: CGFloat.self) { proxy in
                proxy.size.width
            } action: { width in
                if pagerWidth == 0 { pagerWidth = width; return }
                guard width != pagerWidth else { return }
                resnapTask?.cancel()
                resnapTask = Task { @MainActor in
                    try? await Task.sleep(for: .milliseconds(200))
                    guard !Task.isCancelled else { return }
                    pagerWidth = width
                    pagerProxy.scrollTo(PageID(index: index), anchor: .leading)
                }
            }
            .scrollIndicators(.hidden)
            .onAppear { scrolledPage = PageID(index: index) }
            .onChange(of: scrolledPage) { _, page in
                if let page { index = page.index }
            }
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
        .onAppear {
            AppDelegate.orientationLock = .allButUpsideDown
            updateOrientations()
        }
        .onDisappear {
            AppDelegate.orientationLock = .portrait
            updateOrientations()
            (UIApplication.shared.connectedScenes.first as? UIWindowScene)?
                .requestGeometryUpdate(.iOS(interfaceOrientations: .portrait))
        }
    }

    private func updateOrientations() {
        for scene in UIApplication.shared.connectedScenes {
            (scene as? UIWindowScene)?.keyWindow?.rootViewController?
                .setNeedsUpdateOfSupportedInterfaceOrientations()
        }
    }

    @ViewBuilder
    private func filePage(path: String) -> some View {
        if let filesByPath {
            if let parsed = filesByPath[path] {
                if parsed.file.isBinary {
                    ContentUnavailableView("Binary file changed", systemImage: "doc.zipper")
                } else {
                    ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 0) {
                            fileHeader(parsed)
                            Divider()
                            let segments = segmentDiffLines(
                                parsed.lines,
                                comments: pendingComments.filter { $0.file == parsed.file.path }
                            )
                            VStack(alignment: .leading, spacing: 0) {
                                ForEach(segments) { segment in
                                    SelectableDiffText(
                                        lines: segment.lines,
                                        onTapLine: { line in
                                            draftComment = DiffComment(file: parsed.file.path, line: line, snippet: nil)
                                        },
                                        onCommentSelection: { start, end, snippet in
                                            draftComment = DiffComment(file: parsed.file.path, line: start, endLine: end, snippet: snippet)
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
                    .onChange(of: scrollRequest) { _, request in
                        applyScrollRequest(request, proxy: proxy, filePath: parsed.file.path)
                    }
                    .onAppear {
                        applyScrollRequest(scrollRequest, proxy: proxy, filePath: parsed.file.path)
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
    private func fileHeader(_ parsed: ParsedFileDiff) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 8) {
                Image(systemName: "doc.text")
                    .font(.footnote)
                    .foregroundStyle(WhisperColor.textMuted)
                Text("\(Text(directoryPrefix(parsed.file.path)).foregroundColor(WhisperColor.textMuted))\(Text((parsed.file.path as NSString).lastPathComponent).fontWeight(.semibold))")
                    .foregroundStyle(WhisperColor.text)
                    .font(WhisperFont.scaled(13))
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 8)
                if parsed.added > 0 {
                    Text("+\(parsed.added)").foregroundStyle(.green)
                }
                if parsed.removed > 0 {
                    Text("-\(parsed.removed)").foregroundStyle(.red)
                }
            }
            .font(WhisperFont.mono(11))
            if let renamedFrom = parsed.file.renamedFrom {
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
                splitUnifiedDiff(response.diff).map { file in
                    let stats = parseDiffStats(file.text)
                    return (file.path, ParsedFileDiff(
                        file: file,
                        lines: parseUnifiedDiffLines(file.text, includeHunkMarkers: true),
                        added: stats.added,
                        removed: stats.removed
                    ))
                },
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
            let candidates = sessions.filter { $0.kind != "terminal" }
            let lastViewed = projectStore.statusMonitor.lastViewedSession(for: workspace.id)
            guard let target = candidates.first(where: { $0.sessionId == lastViewed }) ?? candidates.first else {
                sendFailed = true
                return
            }
            let text = pendingComments.isEmpty
                ? "About `\(paths[index])`: "
                : compileReview(pendingComments)
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
            withAnimation { scrolledPage = PageID(index: page) }
        }
        scrollRequest = CommentScrollRequest(
            commentID: comment.id,
            file: comment.file,
            generation: (scrollRequest?.generation ?? 0) + 1
        )
    }

    private func applyScrollRequest(_ request: CommentScrollRequest?, proxy: ScrollViewProxy, filePath: String) {
        guard let request, request.file == filePath else { return }
        scrollRequest = nil
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(100))
            withAnimation { proxy.scrollTo(request.commentID, anchor: .center) }
        }
    }
}

private struct PageID: Hashable {
    let index: Int
}

private struct ParsedFileDiff {
    let file: WorkspaceFileDiff
    let lines: [DiffLine]
    let added: Int
    let removed: Int
}

private struct CommentScrollRequest: Equatable {
    let commentID: UUID
    let file: String
    let generation: Int
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
