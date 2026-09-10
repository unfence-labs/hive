import Foundation
import Observation

/// Ordered references share payloads with the legacy message fields.
/// A missing timeline means legacy history; an empty timeline has no provider
/// entries but can still carry server fallback prose in the message content.
struct ConversationTimelineEntry: Codable, Equatable, Identifiable {
    enum Kind: String, Codable {
        case text, reasoning, tool, activity
    }

    let type: Kind
    let id: String
    var text: String?

    init(type: Kind, id: String, text: String? = nil) {
        self.type = type
        self.id = id
        self.text = text
    }
}

/// Owned by the conversation view so disclosure choices survive stream/history replacement.
@Observable
final class ConversationTimelineExpansion {
    private var expanded: Set<String> = []

    func contains(_ id: String) -> Bool { expanded.contains(id) }

    func toggle(_ id: String) {
        if !expanded.insert(id).inserted { expanded.remove(id) }
    }
}

extension ChatMessage {
    var timelineSearchableText: String {
        if timeline?.isEmpty == true {
            return ConversationFindModel.searchableText(content, rendersMarkdown: true)
        }
        return (timeline ?? []).filter { $0.type == .text }.map {
            ConversationFindModel.searchableText($0.text ?? "", rendersMarkdown: true)
        }.joined(separator: "\n")
    }

    func timelineHighlight(for entryId: String, highlight: MessageFindHighlight?) -> MessageFindHighlight? {
        guard let highlight else { return nil }
        var offset = 0
        for entry in timeline ?? [] where entry.type == .text {
            let text = ConversationFindModel.searchableText(entry.text ?? "", rendersMarkdown: true)
            let length = (text as NSString).length
            if entry.id == entryId {
                var ranges: [Range<Int>] = []
                var activeOrdinal: Int?
                for (ordinal, range) in highlight.ranges.enumerated() {
                    let lower = max(range.lowerBound, offset)
                    let upper = min(range.upperBound, offset + length)
                    if lower < upper {
                        if highlight.activeOrdinal == ordinal { activeOrdinal = ranges.count }
                        ranges.append((lower - offset)..<(upper - offset))
                    }
                }
                return ranges.isEmpty ? nil : MessageFindHighlight(ranges: ranges, activeOrdinal: activeOrdinal)
            }
            offset += length + 1
        }
        return nil
    }
}
