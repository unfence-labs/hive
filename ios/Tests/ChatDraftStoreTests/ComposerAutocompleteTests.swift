import XCTest
@testable import HiveMobileStoresCore

final class ComposerAutocompleteTests: XCTestCase {

    // MARK: - Trigger detection

    func testDetectsFileTriggerAtStart() {
        let active = ComposerAutocomplete.detect(in: "#git", supportsCompletions: true)
        XCTAssertEqual(active, .init(trigger: .file, query: "git", triggerOffset: 0))
    }

    func testDetectsTriggerAfterWhitespace() {
        let active = ComposerAutocomplete.detect(in: "fix bug in #auth", supportsCompletions: true)
        XCTAssertEqual(active, .init(trigger: .file, query: "auth", triggerOffset: 11))
    }

    func testDetectsCommandAndAgentTriggers() {
        XCTAssertEqual(ComposerAutocomplete.detect(in: "/comp", supportsCompletions: true)?.trigger, .command)
        XCTAssertEqual(ComposerAutocomplete.detect(in: "ask @rev", supportsCompletions: true)?.trigger, .agent)
    }

    func testEmptyQueryWhenTriggerJustTyped() {
        let active = ComposerAutocomplete.detect(in: "hello #", supportsCompletions: true)
        XCTAssertEqual(active?.query, "")
    }

    func testNoTriggerMidWord() {
        XCTAssertNil(ComposerAutocomplete.detect(in: "issue#42", supportsCompletions: true))
        XCTAssertNil(ComposerAutocomplete.detect(in: "a/b", supportsCompletions: true))
        XCTAssertNil(ComposerAutocomplete.detect(in: "mail@host", supportsCompletions: true))
    }

    func testDismissesOnTrailingSpace() {
        XCTAssertNil(ComposerAutocomplete.detect(in: "#git ", supportsCompletions: true))
    }

    func testDismissesOnNewline() {
        XCTAssertNil(ComposerAutocomplete.detect(in: "#git\n", supportsCompletions: true))
    }

    func testDismissesWhenTriggerDeleted() {
        XCTAssertNil(ComposerAutocomplete.detect(in: "git", supportsCompletions: true))
        XCTAssertNil(ComposerAutocomplete.detect(in: "", supportsCompletions: true))
    }

    func testCommandAndAgentRequireCompletionSupport() {
        XCTAssertNil(ComposerAutocomplete.detect(in: "/comp", supportsCompletions: false))
        XCTAssertNil(ComposerAutocomplete.detect(in: "@rev", supportsCompletions: false))
        XCTAssertNotNil(ComposerAutocomplete.detect(in: "#file", supportsCompletions: false))
    }

    func testDetectAfterNewline() {
        let active = ComposerAutocomplete.detect(in: "line one\n#re", supportsCompletions: true)
        XCTAssertEqual(active?.trigger, .file)
        XCTAssertEqual(active?.query, "re")
    }

    // MARK: - Insertion

    func testInsertReplacesTokenAndAppendsSpace() {
        let active = ComposerAutocomplete.Active(trigger: .file, query: "gi", triggerOffset: 4)
        let result = ComposerAutocomplete.inserting("#src/git.ts", into: "fix #gi", active: active)
        XCTAssertEqual(result, "fix #src/git.ts ")
    }

    func testInsertCommandLabel() {
        let active = ComposerAutocomplete.Active(trigger: .command, query: "comp", triggerOffset: 0)
        let result = ComposerAutocomplete.inserting("/compact", into: "/comp", active: active)
        XCTAssertEqual(result, "/compact ")
    }

    // MARK: - File matching

    private let files = [
        "backend/src/utils/git.ts",
        "backend/src/api/index.ts",
        "frontend/src/api/index.ts",
        "frontend/src/lib/fuzzy-match.ts",
        "README.md",
    ]

    func testBasenameExactBeatsPrefixAndSubstring() {
        let results = ComposerAutocomplete.matchFiles(files + ["a/git.ts.bak", "b/mygit.ts"], query: "git.ts")
        XCTAssertEqual(results.first?.path, "backend/src/utils/git.ts")
    }

    func testPathSubstringMatches() {
        let results = ComposerAutocomplete.matchFiles(files, query: "utils")
        XCTAssertEqual(results.map(\.path), ["backend/src/utils/git.ts"])
    }

    func testSubsequenceMatchesAsLastTier() {
        let results = ComposerAutocomplete.matchFiles(files, query: "fzmt")
        XCTAssertEqual(results.map(\.path), ["frontend/src/lib/fuzzy-match.ts"])
    }

    func testEmptyQueryListsFilesInOrder() {
        let results = ComposerAutocomplete.matchFiles(files, query: "")
        XCTAssertEqual(results.map(\.path), files)
    }

    func testLimitApplied() {
        let many = (0..<30).map { "src/file\($0).ts" }
        XCTAssertEqual(ComposerAutocomplete.matchFiles(many, query: "file").count, 15)
    }

    func testNoMatchReturnsEmpty() {
        XCTAssertTrue(ComposerAutocomplete.matchFiles(files, query: "zzzzzz").isEmpty)
    }

    func testPreparedCandidatesMatchStringOverload() {
        let corpus = files + ["a/git.ts.bak", "b/mygit.ts"]
        let candidates = ComposerAutocomplete.prepareFiles(corpus)
        for query in ["git.ts", "index", "utils", "fzmt", "", "zzzzzz"] {
            let viaStrings = ComposerAutocomplete.matchFiles(corpus, query: query)
            let viaCandidates = ComposerAutocomplete.matchFiles(candidates, query: query)
            XCTAssertEqual(viaStrings, viaCandidates, "ranking diverged for query \"\(query)\"")
        }
    }

    // MARK: - Disambiguation

    func testUniqueBasenameStaysBasename() {
        XCTAssertEqual(ComposerAutocomplete.disambiguate("backend/src/utils/git.ts", in: files), "git.ts")
    }

    func testDuplicateBasenameGetsParentDir() {
        let paths = ["src/api/index.ts", "src/pages/index.ts"]
        XCTAssertEqual(ComposerAutocomplete.disambiguate("src/api/index.ts", in: paths), "api/index.ts")
    }

    func testDuplicateParentDirsExtendToFullPath() {
        // The shared "api/index.ts" and "src/api/index.ts" suffixes never
        // disambiguate, so the full path is the display name (web behavior).
        XCTAssertEqual(ComposerAutocomplete.disambiguate("backend/src/api/index.ts", in: files),
                       "backend/src/api/index.ts")
    }

    // MARK: - Command/agent filtering

    private func item(_ name: String, type: String = "slash_command", source: String = "builtin") -> CompletionItem {
        CompletionItem(type: type, name: name, label: "/\(name)", replacementLabel: nil,
                       description: nil, argumentHint: nil, source: source)
    }

    func testFiltersByTypeOnly() {
        let items = [item("compact"), item("reviewer", type: "agent", source: "project_agent")]
        XCTAssertEqual(ComposerAutocomplete.filterItems(items, type: "agent", query: "").map(\.name), ["reviewer"])
    }

    func testSubstringOrBetterOnly() {
        let items = [item("improve-codebase-architecture"), item("prd-review")]
        // "prd" is only a subsequence of the first item; substring of the second.
        XCTAssertEqual(ComposerAutocomplete.filterItems(items, type: "slash_command", query: "prd").map(\.name),
                       ["prd-review"])
    }

    func testSourceRankBeatsScore() {
        let items = [
            item("yyy-helper", source: "project_command"),
            item("xxx-yyy", source: "builtin"),
        ]
        // Both substring-match "yyy"; builtin outranks project_command.
        XCTAssertEqual(ComposerAutocomplete.filterItems(items, type: "slash_command", query: "yyy").map(\.name),
                       ["xxx-yyy", "yyy-helper"])
    }

    func testExactBeatsPrefixWithinSameSource() {
        let items = [item("compactor"), item("compact")]
        XCTAssertEqual(ComposerAutocomplete.filterItems(items, type: "slash_command", query: "compact").map(\.name),
                       ["compact", "compactor"])
    }

    func testEmptyQueryPreservesScanOrder() {
        let items = [item("b"), item("a")]
        XCTAssertEqual(ComposerAutocomplete.filterItems(items, type: "slash_command", query: "").map(\.name),
                       ["b", "a"])
    }

    // MARK: - Mention pruning

    func testPruneKeepsMentionsPresentInText() {
        let mentions = [
            FileMention(displayName: "git.ts", relativePath: "src/git.ts"),
            FileMention(displayName: "api/index.ts", relativePath: "src/api/index.ts"),
        ]
        let pruned = ComposerAutocomplete.pruneMentions(mentions, text: "look at #git.ts please")
        XCTAssertEqual(pruned.map(\.displayName), ["git.ts"])
    }
}
