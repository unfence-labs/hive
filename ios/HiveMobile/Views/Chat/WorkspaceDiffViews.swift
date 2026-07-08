import SwiftUI

struct WorkspaceDiffDestination: Hashable {
    let workspace: Workspace
}

struct WorkspaceFileDiffDestination: Hashable {
    let workspace: Workspace
    let scope: String
    let paths: [String]
    let index: Int
}

struct ChangedFilesView: View {
    let workspace: Workspace
    @Binding var navigationPath: NavigationPath

    @Environment(ProjectStore.self) private var projectStore

    private var stats: DiffStatResponse? {
        projectStore.statusMonitor.diffStats(for: workspace.id)
    }

    var body: some View {
        List {
            if let stats {
                scopeSection(title: "Branch commits", scope: "committed", files: stats.committed)
                scopeSection(title: "Working tree", scope: "uncommitted", files: stats.uncommitted)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .hiveScreenBackground()
        .navigationTitle("Changed files")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { projectStore.statusMonitor.forceRefresh() }
        .overlay {
            if stats == nil {
                ListLoadingSkeleton()
            } else if stats?.committed.isEmpty == true, stats?.uncommitted.isEmpty == true {
                ContentUnavailableView(
                    "No changes",
                    systemImage: "checkmark.circle",
                    description: Text("This workspace has no diff against its base branch.")
                )
            }
        }
    }

    @ViewBuilder
    private func scopeSection(title: String, scope: String, files: [DiffFileStat]) -> some View {
        if !files.isEmpty {
            Section(title) {
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
                    .listRowBackground(WhisperColor.surfaceSubtle)
                }
            }
        }
    }
}

private struct ChangedFileRow: View {
    let file: DiffFileStat

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(.footnote)
                .foregroundStyle(iconColor)
                .frame(width: 18)
            Text(file.file)
                .font(WhisperFont.mono(12))
                .foregroundStyle(WhisperColor.text)
                .lineLimit(1)
                .truncationMode(.middle)
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
    @State private var filesByPath: [String: WorkspaceFileDiff]?
    @State private var loadFailed = false
    @State private var preparingFix = false

    private let api = APIClient()
    private let draftStore = ChatDraftStore.shared

    var body: some View {
        TabView(selection: $index) {
            ForEach(Array(paths.enumerated()), id: \.offset) { i, path in
                filePage(path: path)
                    .tag(i)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .hiveScreenBackground()
        .navigationTitle((paths[index] as NSString).lastPathComponent)
        .navigationSubtitle(Text("\(index + 1) of \(paths.count)"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    askForFix()
                } label: {
                    if preparingFix {
                        ProgressView()
                    } else {
                        Label("Ask for a fix", systemImage: "bubble.and.pencil")
                    }
                }
                .disabled(preparingFix)
            }
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
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            if let renamedFrom = file.renamedFrom {
                                Text("Renamed from \(renamedFrom)")
                                    .font(WhisperFont.mono(10))
                                    .foregroundStyle(WhisperColor.textMuted)
                                    .padding(.bottom, 6)
                            }
                            ForEach(parseUnifiedDiffLines(file.text)) { line in
                                DiffLineRow(line: line)
                            }
                        }
                        .padding(.horizontal, HiveSpacing.md)
                        .padding(.vertical, HiveSpacing.sm)
                    }
                }
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

    private func loadDiff() async {
        loadFailed = false
        do {
            let response = try await api.fetchWorkspaceDiff(workspaceId: workspace.id, scope: scope)
            filesByPath = Dictionary(
                splitUnifiedDiff(response.diff).map { ($0.path, $0) },
                uniquingKeysWith: { first, _ in first }
            )
        } catch {
            loadFailed = true
        }
    }

    private func askForFix() {
        preparingFix = true
        Task {
            defer { preparingFix = false }
            let sessions = (try? await api.fetchSessions(workspaceId: workspace.id)) ?? []
            guard let target = sessions.first(where: { $0.kind != "terminal" }) else { return }
            let path = paths[index]
            let existing = draftStore.restore(workspaceId: workspace.id, sessionId: target.sessionId)
            let prefix = (existing?.text.isEmpty ?? true) ? "" : existing!.text + "\n"
            draftStore.save(
                workspaceId: workspace.id,
                sessionId: target.sessionId,
                draft: .init(text: prefix + "About `\(path)`: ", attachments: existing?.attachments ?? [])
            )
            navigationPath.removeLast(2)
            navigationPath.append(target)
        }
    }
}
