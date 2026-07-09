import SwiftUI

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
        case .hunk: WhisperColor.textMuted
        }
    }

    private func backgroundColor(_ kind: DiffLine.Kind) -> Color {
        switch kind {
        case .context: .clear
        case .added: Color.green.opacity(0.12)
        case .removed: Color.red.opacity(0.12)
        case .hunk: .clear
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
        case .hunk: WhisperColor.textMuted
        }
    }

    private var background: Color {
        switch line.kind {
        case .context: .clear
        case .added: Color.green.opacity(0.12)
        case .removed: Color.red.opacity(0.12)
        case .hunk: .clear
        }
    }
}
