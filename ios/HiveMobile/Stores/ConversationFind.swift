import Foundation

struct FindableMessage: Equatable {
    let id: String
    let content: String
    let rendersMarkdown: Bool
}

/// Offsets are UTF-16 code units within the message's searchable text (`NSRange` semantics).
struct ConversationFindMatch: Equatable {
    let messageId: String
    let range: Range<Int>
}

/// Offsets are UTF-16 code units within the message's searchable text.
struct MessageFindHighlight: Equatable {
    let ranges: [Range<Int>]
    let activeOrdinal: Int?
}

struct ConversationFindModel: Equatable {
    private(set) var query = ""
    private(set) var matches: [ConversationFindMatch] = []
    private(set) var activeIndex = -1
    private(set) var highlightsByMessage: [String: MessageFindHighlight] = [:]
    private var searchableTexts: [String: (source: String, text: String)] = [:]

    static func == (lhs: ConversationFindModel, rhs: ConversationFindModel) -> Bool {
        lhs.query == rhs.query && lhs.matches == rhs.matches && lhs.activeIndex == rhs.activeIndex
    }

    var matchCount: Int { matches.count }

    var activeMatch: ConversationFindMatch? {
        matches.indices.contains(activeIndex) ? matches[activeIndex] : nil
    }

    /// Telegram-style counter: the newest (bottom-most) match is "1 of N".
    var displayIndex: Int {
        activeIndex >= 0 ? matchCount - activeIndex : 0
    }

    static func matchRanges(in text: String, query: String) -> [Range<Int>] {
        guard !query.isEmpty else { return [] }
        let haystack = text as NSString
        var ranges: [Range<Int>] = []
        var from = 0
        while from < haystack.length {
            let found = haystack.range(
                of: query,
                options: [.caseInsensitive, .diacriticInsensitive],
                range: NSRange(location: from, length: haystack.length - from)
            )
            guard found.location != NSNotFound, found.length > 0 else { break }
            ranges.append(found.location..<(found.location + found.length))
            from = found.location + found.length
        }
        return ranges
    }

    /// The exact string the renderer paints: joined markdown segments for
    /// assistant messages, raw content otherwise.
    static func searchableText(_ content: String, rendersMarkdown: Bool) -> String {
        guard rendersMarkdown, let segments = markdownRenderSegments(content) else { return content }
        return segments.map(\.text).joined()
    }

    /// A query change jumps to the newest match; a content-only change keeps
    /// the active position (clamped).
    mutating func update(messages: [FindableMessage], query: String) {
        let queryChanged = query != self.query
        self.query = query
        var texts: [String: (source: String, text: String)] = [:]
        matches = messages.flatMap { message -> [ConversationFindMatch] in
            let text: String
            if let cached = searchableTexts[message.id], cached.source == message.content {
                text = cached.text
            } else {
                text = Self.searchableText(message.content, rendersMarkdown: message.rendersMarkdown)
            }
            texts[message.id] = (message.content, text)
            return Self.matchRanges(in: text, query: query).map {
                ConversationFindMatch(messageId: message.id, range: $0)
            }
        }
        searchableTexts = texts
        if matches.isEmpty {
            activeIndex = -1
        } else if queryChanged || activeIndex < 0 {
            activeIndex = matches.count - 1
        } else {
            activeIndex = min(activeIndex, matches.count - 1)
        }
        rebuildHighlights()
    }

    mutating func next() { step(1) }
    mutating func previous() { step(-1) }

    private mutating func step(_ direction: Int) {
        guard !matches.isEmpty else {
            activeIndex = -1
            return
        }
        if activeIndex < 0 || activeIndex >= matches.count {
            activeIndex = direction == 1 ? 0 : matches.count - 1
        } else {
            activeIndex = (activeIndex + direction + matches.count) % matches.count
        }
        rebuildHighlights()
    }

    mutating func reset() {
        query = ""
        matches = []
        activeIndex = -1
        searchableTexts = [:]
        rebuildHighlights()
    }

    /// Nil for unmatched messages so their bubbles keep Equatable identity.
    func highlight(for messageId: String) -> MessageFindHighlight? {
        highlightsByMessage[messageId]
    }

    func searchableLength(of messageId: String) -> Int? {
        searchableTexts[messageId].map { ($0.text as NSString).length }
    }

    private mutating func rebuildHighlights() {
        guard !query.isEmpty else {
            highlightsByMessage = [:]
            return
        }
        var ranges: [String: [Range<Int>]] = [:]
        var activeOrdinals: [String: Int] = [:]
        for (index, match) in matches.enumerated() {
            if index == activeIndex {
                activeOrdinals[match.messageId] = ranges[match.messageId, default: []].count
            }
            ranges[match.messageId, default: []].append(match.range)
        }
        highlightsByMessage = Dictionary(uniqueKeysWithValues: ranges.map {
            ($0.key, MessageFindHighlight(ranges: $0.value, activeOrdinal: activeOrdinals[$0.key]))
        })
    }
}
