import XCTest
@testable import HiveMobileStoresCore

final class ServerEndpointTests: XCTestCase {
    func testBuildsURLWithTokenAndQueryItems() {
        let url = ServerEndpoint.webSocketURL(
            host: "h",
            port: "3000",
            token: "t",
            path: "/ws/script/w1",
            queryItems: [URLQueryItem(name: "type", value: "dev")]
        )
        XCTAssertEqual(url?.absoluteString, "ws://h:3000/ws/script/w1?type=dev&token=t")
    }

    func testEmptyTokenOmitsTokenItem() {
        let url = ServerEndpoint.webSocketURL(
            host: "h",
            port: "3000",
            token: "",
            path: "/ws/script/w1",
            queryItems: [URLQueryItem(name: "type", value: "dev")]
        )
        XCTAssertEqual(url?.absoluteString, "ws://h:3000/ws/script/w1?type=dev")
    }

    func testEmptyTokenAndNoQueryItemsProducesNoQuestionMark() {
        let url = ServerEndpoint.webSocketURL(host: "h", port: "3000", token: "", path: "/ws/hub")
        XCTAssertEqual(url?.absoluteString, "ws://h:3000/ws/hub")
        XCTAssertFalse(url?.absoluteString.contains("?") ?? true)
    }

    func testEmptyHostReturnsNil() {
        XCTAssertNil(ServerEndpoint.webSocketURL(host: "", port: "3000", token: "t", path: "/ws/hub"))
    }

    func testNonNumericPortReturnsNil() {
        XCTAssertNil(ServerEndpoint.webSocketURL(host: "h", port: "abc", token: "t", path: "/ws/hub"))
    }
}
