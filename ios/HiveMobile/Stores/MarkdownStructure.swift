import Foundation

struct MarkdownBlockContext {
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
