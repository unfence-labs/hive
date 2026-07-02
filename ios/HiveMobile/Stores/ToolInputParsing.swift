import Foundation

private let parsedToolInputCache: NSCache<NSString, NSDictionary> = {
    let cache = NSCache<NSString, NSDictionary>()
    cache.countLimit = 512
    return cache
}()

func parsedToolInputObject(_ input: String) -> [String: Any]? {
    let key = input as NSString
    if let cached = parsedToolInputCache.object(forKey: key) {
        return cached as? [String: Any]
    }
    guard let data = input.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        return nil
    }
    parsedToolInputCache.setObject(obj as NSDictionary, forKey: key)
    return obj
}
