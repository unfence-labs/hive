import Foundation
import Testing
@testable import HiveMobileStoresCore

/// #298 Settings connection guidance: an authentication failure is classified
/// distinctly from an unreachable server.
struct ConnectionHealthClassificationTests {
    @Test
    func authFailureMapsToInvalidToken() {
        #expect(ConnectionHealth.classify(error: APIError.httpError(statusCode: 401, message: "unauthorized")) == .invalidToken)
        #expect(ConnectionHealth.classify(error: APIError.httpError(statusCode: 403, message: "forbidden")) == .invalidToken)
    }

    @Test
    func networkErrorMapsToUnreachable() {
        let underlying = URLError(.cannotConnectToHost)
        #expect(ConnectionHealth.classify(error: APIError.networkError(underlying)) == .unreachable)
        #expect(ConnectionHealth.classify(error: underlying) == .unreachable)
    }

    @Test
    func otherHTTPErrorMapsToUnreachable() {
        #expect(ConnectionHealth.classify(error: APIError.httpError(statusCode: 500, message: "server error")) == .unreachable)
    }
}
