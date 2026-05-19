import UIKit
import UserNotifications

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        requestPushPermissionAndRegister()
        return true
    }

    // MARK: - Remote notification registration

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { await Self.registerTokenWithBackend(hex) }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        print("[push] registration failed: \(error.localizedDescription)")
    }

    // MARK: - UNUserNotificationCenterDelegate

    /// Suppress notification display when app is in foreground (WS handles it).
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        return []
    }

    /// Handle notification tap — mark workspace as completed so the completion dot appears.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let userInfo = response.notification.request.content.userInfo
        if let workspaceId = userInfo["workspaceId"] as? String {
            await MainActor.run {
                CompletedWorkspacesStore.shared.insert(workspaceId)
            }
        }
    }

    // MARK: - Private

    private func requestPushPermissionAndRegister() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    /// Send the device token to the backend, skipping if unchanged since last registration.
    @MainActor
    private static func registerTokenWithBackend(_ hex: String) async {
        let lastKey = "apnsRegisteredToken"
        guard hex != UserDefaults.standard.string(forKey: lastKey) else { return }
        do {
            try await APIClient().registerDeviceToken(hex)
            UserDefaults.standard.set(hex, forKey: lastKey)
        } catch {
            print("[push] token registration failed: \(error.localizedDescription)")
        }
    }
}
