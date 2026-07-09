import Foundation

/// Offsets are UTF-16 code units within the message content (`NSRange` semantics).
struct ConversationFindMatch: Equatable {
    let messageId: String
    let range: Range<Int>
}

struct MessageFindHighlight: Equatable {
    let query: String
    let activeOrdinal: Int?
}

struct ConversationFindModel: Equatable {
    private(set) var query = ""
    private(set) var matches: [ConversationFindMatch] = []
    private(set) var activeIndex = -1

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

    /// A query change jumps to the newest match; a content-only change keeps
    /// the active position (clamped).
    mutating func update(messages: [(id: String, content: String)], query: String) {
        let queryChanged = query != self.query
        self.query = query
        matches = messages.flatMap { message in
            Self.matchRanges(in: message.content, query: query).map {
                ConversationFindMatch(messageId: message.id, range: $0)
            }
        }
        if matches.isEmpty {
            activeIndex = -1
        } else if queryChanged || activeIndex < 0 {
            activeIndex = matches.count - 1
        } else {
            activeIndex = min(activeIndex, matches.count - 1)
        }
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
    }

    mutating func reset() {
        query = ""
        matches = []
        activeIndex = -1
    }

    func hasMatches(in messageId: String) -> Bool {
        matches.contains { $0.messageId == messageId }
    }

    /// Nil for unmatched messages so their bubbles keep Equatable identity.
    func highlight(for messageId: String) -> MessageFindHighlight? {
        guard !query.isEmpty, hasMatches(in: messageId) else { return nil }
        var activeOrdinal: Int?
        if let active = activeMatch, active.messageId == messageId {
            activeOrdinal = matches[..<activeIndex].filter { $0.messageId == messageId }.count
        }
        return MessageFindHighlight(query: query, activeOrdinal: activeOrdinal)
    }
}
