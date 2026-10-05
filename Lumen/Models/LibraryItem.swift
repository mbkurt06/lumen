import Foundation
import SwiftData

enum LibraryItemKind: String, Codable, CaseIterable {
    case collection
    case document
    case folder

    var systemImage: String {
        switch self {
        case .collection: "rectangle.stack"
        case .document: "doc.text"
        case .folder: "folder"
        }
    }
}

@Model
final class LibraryItem {
    var id: UUID = UUID()
    var parentID: UUID?
    var kindRawValue: String = LibraryItemKind.document.rawValue
    var title: String = ""
    var subtitle: String = ""
    var order: Int = 0
    var isFavorite: Bool = false
    var coverReference: String?
    var metadataJSON: String?
    var createdAt: Date = Date()
    var updatedAt: Date = Date()

    var kind: LibraryItemKind {
        get { LibraryItemKind(rawValue: kindRawValue) ?? .document }
        set {
            kindRawValue = newValue.rawValue
            updatedAt = Date()
        }
    }

    init(
        id: UUID = UUID(),
        parentID: UUID? = nil,
        title: String,
        subtitle: String = "",
        kind: LibraryItemKind,
        order: Int = 0
    ) {
        self.id = id
        self.parentID = parentID
        self.title = title
        self.subtitle = subtitle
        self.kindRawValue = kind.rawValue
        self.order = order
    }
}
