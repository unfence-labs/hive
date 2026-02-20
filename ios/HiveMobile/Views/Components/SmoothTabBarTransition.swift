import SwiftUI
import UIKit

extension View {
    /// Synchronizes the tab bar show/hide with the navigation push/pop animation.
    ///
    /// Pair with `.toolbar(.hidden, for: .tabBar)` on the pushed view.
    /// SwiftUI handles layout (safe area), this bridge handles the visual animation
    /// via the UIKit transition coordinator — matching native UIKit `hidesBottomBarWhenPushed`.
    func smoothTabBarTransition() -> some View {
        background(TabBarTransitionRepresentable())
    }
}

private struct TabBarTransitionRepresentable: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> TabBarTransitionController {
        TabBarTransitionController()
    }
    func updateUIViewController(_ uiViewController: TabBarTransitionController, context: Context) {}
}

private final class TabBarTransitionController: UIViewController {

    // MARK: - Lifecycle

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        guard animated, let tabBar = findTabBar(), let coordinator = findCoordinator() else { return }

        // Push: slide the tab bar down in sync with the navigation push.
        coordinator.animate(alongsideTransition: { _ in
            tabBar.transform = CGAffineTransform(translationX: 0, y: tabBar.bounds.height)
        }, completion: { context in
            // Reset transform regardless — SwiftUI's .toolbar(.hidden) takes over.
            tabBar.transform = .identity
        })
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        guard animated, let tabBar = findTabBar(), let coordinator = findCoordinator() else { return }

        // Pop: override SwiftUI's hidden state and slide the tab bar up.
        tabBar.isHidden = false
        tabBar.alpha = 1
        tabBar.transform = CGAffineTransform(translationX: 0, y: tabBar.bounds.height)

        coordinator.animate(alongsideTransition: { _ in
            tabBar.transform = .identity
        }, completion: { context in
            tabBar.transform = .identity
            if context.isCancelled {
                // Interactive back gesture cancelled — still on ChatView.
                // Let SwiftUI re-hide it on the next layout pass.
            }
        })
    }

    // MARK: - Helpers

    private func findTabBar() -> UITabBar? {
        var vc: UIViewController? = self
        while let current = vc {
            if let tbc = current.tabBarController {
                return tbc.tabBar
            }
            vc = current.parent
        }
        return nil
    }

    private func findCoordinator() -> UIViewControllerTransitionCoordinator? {
        var vc: UIViewController? = self
        while let current = vc {
            if let coord = current.transitionCoordinator {
                return coord
            }
            vc = current.parent
        }
        return nil
    }
}
