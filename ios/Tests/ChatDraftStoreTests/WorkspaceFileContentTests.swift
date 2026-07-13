import XCTest
@testable import HiveMobileStoresCore

final class WorkspaceFileContentTests: XCTestCase {
    func testPlainPathUnchanged() {
        XCTAssertEqual(APIClient.queryValue("docs/notes.md"), "docs/notes.md")
    }

    func testSpaceEncoded() {
        XCTAssertEqual(APIClient.queryValue("my file.md"), "my%20file.md")
    }

    func testReservedQueryCharsEncoded() {
        XCTAssertEqual(APIClient.queryValue("a&b=c+d?e#f.md"), "a%26b%3Dc%2Bd%3Fe%23f.md")
    }

    func testNonASCIIEncoded() {
        XCTAssertEqual(APIClient.queryValue("café.md"), "caf%C3%A9.md")
    }

    func testRoundTripThroughURLComponents() {
        let original = "dir with space/a&b+c#d.md"
        let components = URLComponents(string: "http://h/api?path=\(APIClient.queryValue(original))")
        XCTAssertEqual(components?.queryItems?.first?.value, original)
    }

    func testResponseDecodes() throws {
        let json = Data(##"{"content":"# Title\nbody","path":"docs/a.md"}"##.utf8)
        let response = try JSONDecoder().decode(WorkspaceFileContentResponse.self, from: json)
        XCTAssertEqual(response.content, "# Title\nbody")
        XCTAssertEqual(response.path, "docs/a.md")
    }
}
