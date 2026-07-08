import SwiftUI

struct DiffLine: Identifiable, Equatable {
    enum Kind {
        case context
        case added
        case removed
    }

    let id: Int
    let kind: Kind
    let text: String

    var prefix: String {
        switch kind {
        case .context: " "
        case .added: "+"
        case .removed: "-"
        }
    }
}

func parseDiffStats(_ diff: String) -> (added: Int, removed: Int) {
    var added = 0
    var removed = 0
    for line in diff.split(separator: "\n", omittingEmptySubsequences: false) {
        if line.hasPrefix("+") && !line.hasPrefix("+++") {
            added += 1
        } else if line.hasPrefix("-") && !line.hasPrefix("---") {
            removed += 1
        }
    }
    return (added, removed)
}

func parseUnifiedDiffLines(_ diff: String) -> [DiffLine] {
    var result: [DiffLine] = []
    var index = 0
    for raw in diff.split(separator: "\n", omittingEmptySubsequences: false) {
        let line = String(raw)
        if line.hasPrefix("+++") || line.hasPrefix("---") || line.hasPrefix("@@") { continue }
        if line.hasPrefix("+") {
            result.append(DiffLine(id: index, kind: .added, text: String(line.dropFirst())))
            index += 1
        } else if line.hasPrefix("-") {
            result.append(DiffLine(id: index, kind: .removed, text: String(line.dropFirst())))
            index += 1
        } else {
            let text = line.hasPrefix(" ") ? String(line.dropFirst()) : line
            result.append(DiffLine(id: index, kind: .context, text: text))
            index += 1
        }
    }
    return result
}

struct DiffLinesView: View {
    let lines: [DiffLine]
    var maxLines = 80

    private var visibleLines: [DiffLine] {
        Array(lines.prefix(maxLines))
    }

    private var truncatedCount: Int {
        max(0, lines.count - maxLines)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(visibleLines) { line in
                    HStack(spacing: 0) {
                        Text(line.prefix)
                            .frame(width: 14, alignment: .center)
                            .foregroundStyle(prefixColor(line.kind).opacity(0.6))
                        Text(line.text.isEmpty ? " " : line.text)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .foregroundStyle(prefixColor(line.kind))
                    }
                    .font(WhisperFont.mono(11))
                    .padding(.horizontal, 4)
                    .padding(.vertical, 1)
                    .background(backgroundColor(line.kind))
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 6))

            if truncatedCount > 0 {
                Text("... \(truncatedCount) more lines")
                    .font(WhisperFont.mono(10))
                    .foregroundStyle(WhisperColor.textMuted)
                    .padding(.top, 4)
            }
        }
    }

    private func prefixColor(_ kind: DiffLine.Kind) -> Color {
        switch kind {
        case .context: WhisperColor.textSecondary
        case .added: .green
        case .removed: .red
        }
    }

    private func backgroundColor(_ kind: DiffLine.Kind) -> Color {
        switch kind {
        case .context: .clear
        case .added: Color.green.opacity(0.12)
        case .removed: Color.red.opacity(0.12)
        }
    }
}

struct DiffLineRow: View {
    let line: DiffLine

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            Text(line.prefix)
                .frame(width: 14, alignment: .center)
                .foregroundStyle(color.opacity(0.6))
            Text(line.text.isEmpty ? " " : line.text)
                .frame(maxWidth: .infinity, alignment: .leading)
                .foregroundStyle(color)
        }
        .font(WhisperFont.mono(11))
        .padding(.horizontal, 4)
        .padding(.vertical, 1)
        .background(background)
    }

    private var color: Color {
        switch line.kind {
        case .context: WhisperColor.textSecondary
        case .added: .green
        case .removed: .red
        }
    }

    private var background: Color {
        switch line.kind {
        case .context: .clear
        case .added: Color.green.opacity(0.12)
        case .removed: Color.red.opacity(0.12)
        }
    }
}
