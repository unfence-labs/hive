import Foundation

enum HiveHTTP {
    static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.urlCache = URLCache(
            memoryCapacity: 16 * 1024 * 1024,
            diskCapacity: 256 * 1024 * 1024
        )
        config.requestCachePolicy = .useProtocolCachePolicy
        config.httpMaximumConnectionsPerHost = 6
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }()

    static func clearCache() {
        session.configuration.urlCache?.removeAllCachedResponses()
    }
}
