import Foundation
import SwiftData

enum ContentSegmentKind: String, Codable, CaseIterable {
    case volume
    case part
    case chapter
    case section
    case page
    case heading
    case paragraph
    case sentence
    case phrase
    case note
    case custom
}

@Model
final class ContentSegment {
    var id: UUID = UUID()
    var documentID: UUID = UUID()
    var parentSegmentID: UUID?
    var kindRawValue: String = ContentSegmentKind.paragraph.rawValue
    var order: Int = 0

    var title: String = ""
    var text: String = ""
    var secondaryText: String = ""
    var translation: String = ""

    var audioReference: String?
    var mediaReference: String?
    var startTime: Double?
    var endTime: Double?
    var metadataJSON: String?

    var createdAt: Date = Date()
    var updatedAt: Date = Date()

    var kind: ContentSegmentKind {
        get { ContentSegmentKind(rawValue: kindRawValue) ?? .custom }
        set {
            kindRawValue = newValue.rawValue
            updatedAt = Date()
        }
    }

    init(
        id: UUID = UUID(),
        documentID: UUID,
        parentSegmentID: UUID? = nil,
        kind: ContentSegmentKind,
        order: Int = 0,
        title: String = "",
        text: String = ""
    ) {
        self.id = id
        self.documentID = documentID
        self.parentSegmentID = parentSegmentID
        self.kindRawValue = kind.rawValue
        self.order = order
        self.title = title
        self.text = text
    }
}
