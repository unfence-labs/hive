import XCTest
@testable import HiveMobileStoresCore

final class ChatImageExportTests: XCTestCase {
    func testExportPreservesOriginalBytesAndCleansUpOnlyItsOwnDirectory() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let unrelated = root.appendingPathComponent("keep.txt")
        try Data("keep".utf8).write(to: unrelated)
        let original = Data([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])
        var export: ChatImageExport? = try ChatImageExport(
            data: original, fileExtension: "PNG", temporaryRoot: root
        )
        let url = try XCTUnwrap(export?.url)

        XCTAssertTrue(url.isFileURL)
        XCTAssertEqual(url.lastPathComponent, "image.png")
        XCTAssertNil(url.query)
        XCTAssertEqual(try Data(contentsOf: url), original)

        export = nil
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.deletingLastPathComponent().path))
        XCTAssertEqual(try Data(contentsOf: unrelated), Data("keep".utf8))
    }

    func testExportsRemainIndependentUntilTheirShareSheetReleasesThem() throws {
        let first = try ChatImageExport(data: Data([1]), fileExtension: "png")
        let second = try ChatImageExport(data: Data([2]), fileExtension: "png")
        XCTAssertNotEqual(first.url, second.url)
        XCTAssertEqual(try Data(contentsOf: first.url), Data([1]))
        XCTAssertEqual(try Data(contentsOf: second.url), Data([2]))
    }

    func testRejectsEmptyDataAndUnsafeFileExtensions() {
        XCTAssertThrowsError(try ChatImageExport(data: Data(), fileExtension: "png"))
        for fileExtension in ["", "../png", "png?token=secret", "png/x", ".png"] {
            XCTAssertThrowsError(try ChatImageExport(data: Data([1]), fileExtension: fileExtension))
        }
    }
}
