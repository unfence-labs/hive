import Foundation
import Testing
@testable import HiveMobileStoresCore

/// Tests for the PRD #254 REST history page shape (`{ messages, hasMore }`) and
/// the live output-scalar computation, which must match the backend's
/// `computeTruncatedField` byte-for-byte so live and history tools agree.
struct MessagesPageDecodingTests {
    // MARK: - MessagesPage decoding

    @Test
    func decodesMessagesPageWithHasMore() throws {
        let data = try #require("""
        {
          "messages": [
            {
              "id": "msg-1",
              "sessionId": "session-1",
              "role": "user",
              "content": "hello",
              "timestamp": "2026-01-01T00:00:00.000Z"
            },
            {
              "id": "msg-2",
              "sessionId": "session-1",
              "role": "assistant",
              "content": "hi there",
              "timestamp": "2026-01-01T00:00:01.000Z"
            }
          ],
          "hasMore": true
        }
        """.data(using: .utf8))

        let page = try JSONDecoder().decode(MessagesPage.self, from: data)
        #expect(page.messages.count == 2)
        #expect(page.messages.first?.id == "msg-1")
        #expect(page.hasMore == true)
        // The next `before` cursor is messages.first?.id.
        #expect(page.messages.first?.id == "msg-1")
    }

    @Test
    func decodesEmptyMessagesPage() throws {
        let data = try #require("""
        { "messages": [], "hasMore": false }
        """.data(using: .utf8))

        let page = try JSONDecoder().decode(MessagesPage.self, from: data)
        #expect(page.messages.isEmpty)
        #expect(page.hasMore == false)
    }

    @Test
    func decodesHistoryMessageWithTruncatedToolOutput() throws {
        // A persisted assistant turn as the REST history serializes it: the heavy
        // tool output is omitted, preview + scalars present.
        let data = try #require("""
        {
          "messages": [
            {
              "id": "msg-1",
              "sessionId": "session-1",
              "role": "assistant",
              "content": "ran a command",
              "timestamp": "2026-01-01T00:00:00.000Z",
              "toolCalls": [
                {
                  "id": "tool-1",
                  "name": "Bash",
                  "input": "{}",
                  "outputPreview": "first lines...",
                  "outputLineCount": 9000,
                  "outputByteLength": 300000,
                  "outputTruncated": true
                }
              ]
            }
          ],
          "hasMore": false
        }
        """.data(using: .utf8))

        let page = try JSONDecoder().decode(MessagesPage.self, from: data)
        let tool = try #require(page.messages.first?.toolCalls?.first)
        #expect(tool.output == nil)
        #expect(tool.outputTruncated == true)
        #expect(tool.outputLineCount == 9000)
    }

    // MARK: - Live output scalar computation (matches backend)

    @Test
    func computesScalarsForEmptyOutput() {
        let s = computeOutputScalars("")
        #expect(s.lineCount == 0)        // empty => 0 lines (matches backend)
        #expect(s.byteLength == 0)
        #expect(s.truncated == false)
        #expect(s.preview == "")
    }

    @Test
    func computesScalarsForSingleLine() {
        let s = computeOutputScalars("hello")
        #expect(s.lineCount == 1)        // newlines + 1
        #expect(s.byteLength == 5)
        #expect(s.truncated == false)
        #expect(s.preview == "hello")
    }

    @Test
    func computesScalarsForMultiLine() {
        // "a\nb\nc" => 2 newlines + 1 = 3 lines.
        let s = computeOutputScalars("a\nb\nc")
        #expect(s.lineCount == 3)
        #expect(s.byteLength == 5)
        #expect(s.truncated == false)
    }

    @Test
    func computesScalarsWithTrailingNewline() {
        // "a\nb\n" => 2 newlines + 1 = 3 (matches backend split-based count).
        let s = computeOutputScalars("a\nb\n")
        #expect(s.lineCount == 3)
        #expect(s.byteLength == 4)
    }

    @Test
    func computesByteLengthForMultibyteScalars() {
        // "é" is 2 UTF-8 bytes; "😀" is 4. Byte length is UTF-8, not char count.
        let s = computeOutputScalars("é😀")
        #expect(s.byteLength == 6)
        #expect(s.lineCount == 1)
        #expect(s.truncated == false)
    }

    @Test
    func truncatesOutputOverCapOnByteBoundary() {
        // 3000 ASCII bytes > 2048 cap => truncated, preview is exactly 2048 bytes.
        let full = String(repeating: "x", count: 3000)
        let s = computeOutputScalars(full)
        #expect(s.truncated == true)
        #expect(s.byteLength == 3000)
        #expect(s.lineCount == 1)
        #expect(Array(s.preview.utf8).count == 2048)
    }

    @Test
    func previewNeverSplitsMultibyteScalar() {
        // Fill just past the cap with 2-byte scalars so the boundary lands mid-
        // character; the slice must walk back to a scalar boundary (<= 2048).
        let full = String(repeating: "é", count: 1100) // 2200 bytes
        let s = computeOutputScalars(full)
        #expect(s.truncated == true)
        #expect(s.byteLength == 2200)
        let previewBytes = Array(s.preview.utf8).count
        #expect(previewBytes <= 2048)
        // The preview must be valid UTF-8 made only of whole "é" scalars.
        #expect(s.preview.allSatisfy { $0 == "é" })
        #expect(previewBytes % 2 == 0)
    }

    @Test
    func outputExactlyAtCapIsNotTruncated() {
        // byteLength == cap is NOT > cap, so not truncated (boundary check).
        let full = String(repeating: "x", count: 2048)
        let s = computeOutputScalars(full)
        #expect(s.byteLength == 2048)
        #expect(s.truncated == false)
        #expect(s.preview == full)
    }
}
