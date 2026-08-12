import Foundation
import Security

protocol TokenStore: Sendable {
    func load(for identifier: String) throws -> String?
    func save(_ token: String, for identifier: String) throws
}

enum KeychainTokenStoreError: Error {
    case unexpectedStatus(OSStatus)
}

struct KeychainTokenStore: TokenStore {
    private let service: String
    private let account: String

    init(
        service: String = Bundle.main.bundleIdentifier ?? "com.hive.mobile",
        account: String = "server-auth-token"
    ) {
        self.service = service
        self.account = account
    }

    func load(for identifier: String) throws -> String? {
        var query = baseQuery(identifier: identifier)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else {
            throw KeychainTokenStoreError.unexpectedStatus(status)
        }
        guard let data = result as? Data,
              let token = String(data: data, encoding: .utf8) else {
            return nil
        }
        return token
    }

    func save(_ token: String, for identifier: String) throws {
        let data = Data(token.utf8)
        let attributes = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ] as [String: Any]

        let query = baseQuery(identifier: identifier)
        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw KeychainTokenStoreError.unexpectedStatus(updateStatus)
        }

        var item = query
        item.merge(attributes) { _, new in new }
        let addStatus = SecItemAdd(item as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw KeychainTokenStoreError.unexpectedStatus(addStatus)
        }
    }

    private func baseQuery(identifier: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "\(account):\(identifier)"
        ]
    }
}
