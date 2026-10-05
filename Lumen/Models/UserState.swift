import Foundation
import SwiftData

@Model
final class ReadingState {
    var id: UUID = UUID()
    var documentID: UUID = UUID()
    var lastSegmentID: UUID?
    var lastOpenedAt: Date = Date()
    var scrollAnchor: String?
    var fontScale: Double = 1.0

    init(documentID: UUID) {
        self.documentID = documentID
    }
}

@Model
final class MemorizationState {
    var id: UUID = UUID()
    var segmentID: UUID = UUID()
    var repeatCount: Int = 0
    var repeatTarget: Int = 10
    var playbackRate: Double = 1.0
    var isMemorized: Bool = false
    var lastPracticedAt: Date?

    init(segmentID: UUID) {
        self.segmentID = segmentID
    }
}

@Model
final class SyncedPreference {
    var id: UUID = UUID()
    var key: String = ""
    var value: String = ""
    var updatedAt: Date = Date()

    init(key: String, value: String) {
        self.key = key
        self.value = value
    }
}
