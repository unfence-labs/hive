import Testing
@testable import HiveMobileStoresCore

@Suite("Message clipboard text")
struct MessageClipboardTextTests {
    private func makeMessage(content: String) -> ChatMessage {
        ChatMessage(
            id: "m1", sessionId: "s1", role: .assistant,
            content: content,
            images: nil, toolCalls: nil,
            timestamp: "2026-07-06T12:00:00.000Z", cancelled: nil, durationMs: nil
        )
    }

    @Test("Single-paragraph message copies the exact string")
    func singleParagraph() {
        let message = makeMessage(content: "Just one paragraph.")
        #expect(message.clipboardText == "Just one paragraph.")
    }

    @Test("Multi-paragraph message preserves line breaks verbatim")
    func multiParagraph() {
        let message = makeMessage(content: "First.\n\nSecond.")
        #expect(message.clipboardText == "First.\n\nSecond.")
    }

    @Test("Code-fenced content keeps fences and newlines verbatim")
    func codeFenced() {
        let content = "Intro\n\n```swift\nlet x = 1\n```\n\nDone."
        let message = makeMessage(content: content)
        #expect(message.clipboardText == content)
    }

    @Test("Empty content copies an empty string")
    func emptyContent() {
        let message = makeMessage(content: "")
        #expect(message.clipboardText == "")
    }
}
