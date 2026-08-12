import CryptoKit
import UIKit

/// In-memory image cache backed by NSCache.
/// Evicts automatically under memory pressure.
final class ImageCache {
    static let shared = ImageCache()

    private let cache = NSCache<NSString, UIImage>()

    private init() {
        cache.countLimit = 200
        cache.totalCostLimit = 50 * 1024 * 1024 // ~50 MB
    }

    func image(forKey key: String) -> UIImage? {
        cache.object(forKey: key as NSString)
    }

    func store(_ image: UIImage, forKey key: String) {
        let cost = image.cgImage.map { $0.bytesPerRow * $0.height } ?? 0
        cache.setObject(image, forKey: key as NSString, cost: cost)
    }

    func clear() {
        cache.removeAllObjects()
    }

    /// Stores a downscaled copy of the image, capped to `maxSize` in points.
    /// Keeps memory per entry tiny so the cache rarely evicts.
    func storeThumbnail(_ image: UIImage, forKey key: String, maxSize: CGSize) {
        let scale = min(maxSize.width / image.size.width, maxSize.height / image.size.height, 1)
        if scale >= 1 {
            store(image, forKey: key)
            return
        }
        let targetSize = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: targetSize)
        let thumb = renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: targetSize)) }
        store(thumb, forKey: key)
    }

    /// Stable cache key — short strings (URL paths) used directly, long strings (base64) hashed.
    static func key(for string: String) -> String {
        if string.count < 500 { return string }
        let digest = SHA256.hash(data: Data(string.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}
