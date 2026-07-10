import XCTest
@testable import HiveMobileStoresCore

final class ScriptStreamControlTests: XCTestCase {
    func testParsesReady() {
        XCTAssertEqual(ScriptStreamControl.parse(#"{"type":"ready"}"#), .ready)
    }

    func testParsesExitWithCode() {
        XCTAssertEqual(ScriptStreamControl.parse(#"{"type":"exit","code":0}"#), .exit(code: 0))
    }

    func testParsesExitWithoutCode() {
        XCTAssertEqual(ScriptStreamControl.parse(#"{"type":"exit"}"#), .exit(code: nil))
    }

    func testParsesErrorWithMessage() {
        XCTAssertEqual(
            ScriptStreamControl.parse(#"{"type":"error","message":"Unauthorized"}"#),
            .error(message: "Unauthorized")
        )
    }

    func testParsesErrorWithoutMessage() {
        XCTAssertEqual(ScriptStreamControl.parse(#"{"type":"error"}"#), .error(message: nil))
    }

    func testUnknownTypeReturnsNil() {
        XCTAssertNil(ScriptStreamControl.parse(#"{"type":"resize"}"#))
    }

    func testInvalidJSONReturnsNil() {
        XCTAssertNil(ScriptStreamControl.parse("not json"))
    }

    func testMissingTypeReturnsNil() {
        XCTAssertNil(ScriptStreamControl.parse(#"{"no":"type"}"#))
    }
}
