import ActivityKit
import Foundation
import UIKit

/// Manages the Live Activity lifecycle for streaming workspaces.
///
/// Starts a Dynamic Island / Lock Screen Live Activity when the app
/// backgrounds with active workspaces, updates it as streaming state
/// changes, and ends it when all workspaces go idle or the app returns
/// to the foreground.
@MainActor
final class LiveActivityManager {
    private var currentActivity: Activity<StreamingAttributes>?
    private var backgroundTaskId: UIBackgroundTaskIdentifier = .invalid
    private var isInBackground = false

    // MARK: - Scene Phase Changes

    func didEnterBackground(streamingIds: Set<String>, labelResolver: (String) -> String?) {
        isInBackground = true
        guard !streamingIds.isEmpty else { return }
        startActivity(streamingIds: streamingIds, labelResolver: labelResolver)
        beginBackgroundTask()
    }

    func didEnterForeground() {
        isInBackground = false
        endActivity()
        endBackgroundTask()
    }

    // MARK: - Streaming State Changes

    func streamingDidChange(streamingIds: Set<String>, labelResolver: (String) -> String?) {
        guard isInBackground else { return }

        if streamingIds.isEmpty {
            endActivity()
            endBackgroundTask()
        } else if currentActivity != nil {
            updateActivity(streamingIds: streamingIds, labelResolver: labelResolver)
        } else {
            startActivity(streamingIds: streamingIds, labelResolver: labelResolver)
        }
    }

    // MARK: - Activity Lifecycle

    private func startActivity(streamingIds: Set<String>, labelResolver: (String) -> String?) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        guard currentActivity == nil else {
            updateActivity(streamingIds: streamingIds, labelResolver: labelResolver)
            return
        }

        let state = contentState(streamingIds: streamingIds, labelResolver: labelResolver)
        let content = ActivityContent(state: state, staleDate: nil)

        do {
            currentActivity = try Activity<StreamingAttributes>.request(
                attributes: StreamingAttributes(),
                content: content,
                pushType: nil
            )
        } catch {
            // Activity creation can fail if the user disabled Live Activities
        }
    }

    private func updateActivity(streamingIds: Set<String>, labelResolver: (String) -> String?) {
        guard let activity = currentActivity else { return }
        let state = contentState(streamingIds: streamingIds, labelResolver: labelResolver)
        let content = ActivityContent(state: state, staleDate: nil)
        Task { await activity.update(content) }
    }

    private func endActivity() {
        guard let activity = currentActivity else { return }
        currentActivity = nil
        Task { await activity.end(nil, dismissalPolicy: .immediate) }
    }

    // MARK: - Background Task

    private func beginBackgroundTask() {
        guard backgroundTaskId == .invalid else { return }
        backgroundTaskId = UIApplication.shared.beginBackgroundTask { [weak self] in
            self?.endBackgroundTask()
        }
    }

    private func endBackgroundTask() {
        guard backgroundTaskId != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTaskId)
        backgroundTaskId = .invalid
    }

    // MARK: - Helpers

    private func contentState(
        streamingIds: Set<String>,
        labelResolver: (String) -> String?
    ) -> StreamingAttributes.ContentState {
        let labels = streamingIds
            .compactMap { labelResolver($0) }
            .sorted()
            .prefix(3)
        return .init(activeCount: streamingIds.count, workspaceLabels: Array(labels))
    }
}
