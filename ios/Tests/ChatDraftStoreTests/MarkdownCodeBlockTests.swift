import Foundation
import Testing
@testable import HiveMobileStoresCore

@Suite("Markdown code block actions")
struct MarkdownCodeBlockTests {
    @Test("Code is detected without treating inline code as a block")
    func codeDetection() {
        #expect(markdownContainsCodeBlock("Use `npm test`.") == false)
        #expect(markdownContainsCodeBlock("```bash\nnpm test\n```"))
        #expect(markdownContainsCodeBlock("```unknown\npartial"))
        #expect(markdownContainsCodeBlock("    indented code\n"))
    }

    @Test("Actions become available when a fence closes, before the response ends")
    func closure() {
        let source = "```bash\nnpm test\n"
        #expect(completedMarkdownCodeBlocks(source).isEmpty)
        #expect(completedMarkdownCodeBlocks(source + "```") == ["npm test"])
        #expect(completedMarkdownCodeBlocks(source + "```\nStill working") == ["npm test"])
    }

    @Test("A later unfinished block does not disable an earlier complete block")
    func multipleBlocks() {
        let source = "```\nfirst\n```\n\n```swift\nsecond"
        #expect(completedMarkdownCodeBlocks(source) == ["first"])
    }

    @Test("An indented fence inside code cannot enable actions early")
    func indentedFenceContent() {
        #expect(completedMarkdownCodeBlocks("```\ntext\n    ```\n").isEmpty)
    }

    @Test("Shorter or different fences cannot close a code block", arguments: ["```", "~~~~", "````suffix"])
    func mismatchedFence(closing: String) {
        #expect(completedMarkdownCodeBlocks("````swift\nlet x = 1\n" + closing).isEmpty)
    }

    @Test("Longer closing fences and tilde fences are supported")
    func fenceVariants() {
        #expect(completedMarkdownCodeBlocks("~~~\ntext\n~~~~  ") == ["text"])
        #expect(completedMarkdownCodeBlocks("````\n```\n`````\n") == ["```"])
    }

    @Test("Code whitespace and Unicode are retained when matching completed blocks")
    func whitespace() {
        let code = "  echo '🐝'  \n\tprintf done"
        #expect(completedMarkdownCodeBlocks("```sh\n" + code + "\n```") == [code])
    }
}
