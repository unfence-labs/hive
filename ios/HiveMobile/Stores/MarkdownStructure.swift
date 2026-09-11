import Foundation

struct MarkdownBlockContext: Equatable {
    var identity: [Int] = []
    var headerLevel: Int?
    var isCodeBlock = false
    var isBlockQuote = false
    var listItemID: Int?
    var listOrdinal = 1
    var isOrdered = false
    var indentLevel = 0

    var listPrefix: String? {
        guard listItemID != nil else { return nil }
        return isOrdered ? "\(listOrdinal). " : "- "
    }
}

func markdownBlockContext(_ intent: PresentationIntent?) -> MarkdownBlockContext {
    var ctx = MarkdownBlockContext()
    guard let intent else { return ctx }
    ctx.identity = intent.components.map(\.identity)
    var nearestListIsOrdered: Bool?
    for component in intent.components {
        switch component.kind {
        case .header(let level):
            ctx.headerLevel = level
        case .codeBlock:
            ctx.isCodeBlock = true
        case .blockQuote:
            ctx.isBlockQuote = true
        case .listItem(let ordinal):
            if ctx.listItemID == nil {
                ctx.listItemID = component.identity
                ctx.listOrdinal = ordinal
            }
        case .orderedList:
            if nearestListIsOrdered == nil { nearestListIsOrdered = true }
            ctx.indentLevel += 1
        case .unorderedList:
            if nearestListIsOrdered == nil { nearestListIsOrdered = false }
            ctx.indentLevel += 1
        default:
            break
        }
    }
    ctx.isOrdered = nearestListIsOrdered ?? false
    return ctx
}

/// One renderable piece of a parsed markdown string, expressed as data so the
/// assembly can be unit-tested without UIKit. The view maps each segment to
/// concrete fonts/colors.
struct MarkdownRenderSegment: Equatable {
    enum Kind: Equatable {
        case content     // actual run text; may carry a link + background
        case separator   // synthesized "\n" between blocks; no link/background
        case listPrefix  // synthesized "- " / "1. "; no link/background
    }

    var text: String
    var inline: InlinePresentationIntent
    var block: MarkdownBlockContext
    var linkURL: URL?
    var kind: Kind
}

/// Parse `markdown` and produce the ordered segments the renderer should append.
/// Returns nil when parsing fails (the caller renders a plain-text fallback).
func markdownRenderSegments(_ markdown: String) -> [MarkdownRenderSegment]? {
    guard let parsed = try? AttributedString(
        markdown: markdown,
        options: .init(interpretedSyntax: .full, failurePolicy: .returnPartiallyParsedIfPossible)
    ) else {
        return nil
    }

    var segments: [MarkdownRenderSegment] = []
    var lastBlockIdentity: [Int]?
    var lastListItemID: Int?

    for run in parsed.runs {
        let block = markdownBlockContext(run.presentationIntent)
        let inline = run.inlinePresentationIntent ?? []

        if block.identity != lastBlockIdentity {
            if lastBlockIdentity != nil {
                segments.append(MarkdownRenderSegment(
                    text: "\n", inline: inline, block: block, linkURL: nil, kind: .separator))
            }
            if let prefix = block.listPrefix, block.listItemID != lastListItemID {
                segments.append(MarkdownRenderSegment(
                    text: prefix, inline: inline, block: block, linkURL: nil, kind: .listPrefix))
            }
            lastListItemID = block.listItemID
            lastBlockIdentity = block.identity
        }

        segments.append(MarkdownRenderSegment(
            text: String(parsed[run.range].characters),
            inline: inline, block: block, linkURL: run.link, kind: .content))
    }
    return segments
}

/// True when `markdown` contains a construct the selectable renderer cannot
/// render faithfully (GFM tables, images, task lists, thematic breaks), meaning
/// the message should fall back to MarkdownUI. Content inside fenced code blocks
/// is ignored: `---`, `![]`, or `| - |` there are code, not markup, and keeping
/// such messages in the selectable renderer preserves native text selection,
/// which matters most for code. Over-detection outside fences is still safe (the
/// message just renders via MarkdownUI); under-detection is the failure to avoid.
func markdownNeedsRichRenderer(_ markdown: String) -> Bool {
    var insideFence = false

    for rawLine in markdown.split(separator: "\n", omittingEmptySubsequences: false) {
        let line = rawLine.trimmingCharacters(in: .whitespaces)

        // A ``` or ~~~ line opens or closes a fenced code block.
        if line.hasPrefix("```") || line.hasPrefix("~~~") {
            insideFence.toggle()
            continue
        }
        if insideFence || line.isEmpty { continue }

        if line.contains("![") { return true }  // image

        // GFM table delimiter row, e.g. "| --- | :--: |" or "---|---"
        if line.contains("|"), line.contains("-"),
           line.allSatisfy({ "|:- ".contains($0) }) {
            return true
        }
        // Thematic break: 3+ of the same -, *, or _ on their own line
        if line.count >= 3, let first = line.first, "-*_".contains(first),
           line.allSatisfy({ $0 == first }) {
            return true
        }
        // Task list item: "- [ ] ", "* [x] ", "+ [X] "
        if let marker = line.first, "-*+".contains(marker) {
            let rest = line.dropFirst().drop(while: { $0 == " " })
            if rest.hasPrefix("[ ]") || rest.hasPrefix("[x]") || rest.hasPrefix("[X]") {
                return true
            }
        }
    }
    return false
}

func markdownContainsCodeBlock(_ markdown: String) -> Bool {
    markdownRenderSegments(markdown)?.contains { $0.block.isCodeBlock } == true
}

/// Only closed fences enable actions during streaming. Markdown parsing and code
/// extraction remain Foundation-owned; this scan only finds a safe source prefix.
func completedMarkdownCodeBlocks(_ markdown: String) -> Set<String> {
    var fence: (marker: Character, count: Int)?
    var completedEnd = markdown.startIndex
    var lineStart = markdown.startIndex
    while lineStart < markdown.endIndex {
        let lineEnd = markdown[lineStart...].firstIndex(of: "\n") ?? markdown.endIndex
        let rawLine = markdown[lineStart..<lineEnd]
        let indentation = rawLine.prefix(while: { $0 == " " }).count
        let line = rawLine.dropFirst(indentation)
        let nextLine = lineEnd < markdown.endIndex ? markdown.index(after: lineEnd) : lineEnd
        if indentation <= 3, let marker = line.first, marker == "`" || marker == "~" {
            let count = line.prefix(while: { $0 == marker }).count
            let suffix = line.dropFirst(count)
            if let current = fence {
                if marker == current.marker, count >= current.count,
                   suffix.allSatisfy({ $0.isWhitespace }) {
                    fence = nil
                    completedEnd = nextLine
                }
            } else if count >= 3, marker != "`" || !suffix.contains("`") {
                fence = (marker, count)
            }
        }
        lineStart = nextLine
    }

    let segments = markdownRenderSegments(String(markdown[..<completedEnd])) ?? []
    var blocks: [[Int]: String] = [:]
    for segment in segments where segment.block.isCodeBlock && segment.kind == .content {
        blocks[segment.block.identity, default: ""] += segment.text
    }
    return Set(blocks.values.map { $0.trimmingCharacters(in: .newlines) })
}

/// Boundary = blank line outside any ``` / ~~~ fenced block, so the stable
/// prefix never ends inside an open code block.
func splitStableMarkdownPrefix(_ text: String) -> (stable: String, tail: String) {
    var insideFence = false
    var lastSafeBoundary: String.Index?
    var lineStart = text.startIndex

    while lineStart < text.endIndex {
        let lineEnd = text[lineStart...].firstIndex(of: "\n") ?? text.endIndex
        let line = text[lineStart..<lineEnd].trimmingCharacters(in: .whitespaces)
        if line.hasPrefix("```") || line.hasPrefix("~~~") {
            insideFence.toggle()
        } else if lineStart == lineEnd, !insideFence, lineEnd < text.endIndex {
            lastSafeBoundary = text.index(after: lineEnd)
        }
        guard lineEnd < text.endIndex else { break }
        lineStart = text.index(after: lineEnd)
    }

    guard let boundary = lastSafeBoundary else { return ("", text) }
    return (String(text[..<boundary]), String(text[boundary...]))
}
