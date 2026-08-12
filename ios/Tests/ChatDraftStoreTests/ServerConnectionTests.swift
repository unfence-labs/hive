import Foundation
import XCTest
@testable import HiveMobileStoresCore

final class ServerConnectionTests: XCTestCase {
    func testReplaceWritesTokenBeforeAddressAndReturnsSnapshot() throws {
        let suiteName = "ServerConnectionTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let tokenStore = TestTokenStore()
        let store = ServerConnectionStore(defaults: defaults, tokenStore: tokenStore)
        let connection = try XCTUnwrap(
            ServerConnection(host: "hive.local", port: "9420", authToken: "secret")
        )

        try store.replace(with: connection)

        XCTAssertEqual(store.snapshot(), connection)
        XCTAssertTrue(store.hasConfiguration)
        XCTAssertEqual(tokenStore.savedTokens, ["secret"])
        XCTAssertEqual(tokenStore.savedIdentifiers, ["hive.local:9420"])
    }

    func testFailedTokenWriteDoesNotPersistAddress() throws {
        let suiteName = "ServerConnectionTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let tokenStore = TestTokenStore(saveError: TestError.failed)
        let store = ServerConnectionStore(defaults: defaults, tokenStore: tokenStore)
        let connection = try XCTUnwrap(
            ServerConnection(host: "hive.local", port: "9420", authToken: "secret")
        )

        XCTAssertThrowsError(try store.replace(with: connection))
        XCTAssertNil(store.snapshot())
    }

    func testDoesNotReadLegacyDefaultsKeys() throws {
        let suiteName = "ServerConnectionTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        defaults.set("legacy.local", forKey: "serverHost")
        defaults.set("9420", forKey: "serverPort")
        defaults.set("legacy-token", forKey: "authToken")
        let store = ServerConnectionStore(
            defaults: defaults,
            tokenStore: TestTokenStore(tokens: ["legacy.local:9420": "token"])
        )

        XCTAssertNil(store.snapshot())
        XCTAssertFalse(store.hasConfiguration)
    }

    func testTokenIsScopedToStoredAddress() throws {
        let suiteName = "ServerConnectionTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        defaults.set("old.local", forKey: "hive.server.connection.host")
        defaults.set(9420, forKey: "hive.server.connection.port")
        let tokenStore = TestTokenStore(tokens: ["new.local:9420": "new-token"])
        let store = ServerConnectionStore(defaults: defaults, tokenStore: tokenStore)

        XCTAssertNil(store.snapshot())
    }
}

private enum TestError: Error {
    case failed
}

private final class TestTokenStore: TokenStore, @unchecked Sendable {
    private(set) var tokens: [String: String]
    private(set) var savedTokens: [String] = []
    private(set) var savedIdentifiers: [String] = []
    private let saveError: Error?

    init(tokens: [String: String] = [:], saveError: Error? = nil) {
        self.tokens = tokens
        self.saveError = saveError
    }

    func load(for identifier: String) throws -> String? {
        tokens[identifier]
    }

    func save(_ token: String, for identifier: String) throws {
        if let saveError { throw saveError }
        savedTokens.append(token)
        savedIdentifiers.append(identifier)
        tokens[identifier] = token
    }
}
