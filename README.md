# Lumen

Lumen is a personal Apple-platform library, reading, listening, and memorization application.

## Platforms
- iPhone
- iPad
- macOS

## Architecture
- Swift 6 / SwiftUI
- SwiftData
- iCloud / CloudKit synchronization
- Shared codebase for iOS, iPadOS, and macOS
- Extensible hierarchical content model

## Content hierarchy

The application does not hard-code any real collection, work, title, or text.

A library can grow through generic nodes such as:

```
Library
└── Collection
    ├── Collection / Folder
    └── Document
        └── Segment
            ├── Volume
            ├── Part
            ├── Chapter
            ├── Section
            ├── Page
            ├── Heading
            ├── Paragraph
            ├── Sentence
            ├── Phrase
            └── Custom
```

Segments can be nested recursively, so new content structures can be added later without changing the basic library model.

## User state

Reading position, memorization state, repeat counters, playback speed, favorites, and synchronized preferences are separate from the content hierarchy.

## Storage policy

This repository contains application source code only.

User-created/imported content, reading state, memorization progress, counters, playback preferences, and library metadata belong to the user's iCloud/CloudKit store and are not committed to Git.

Large binary assets should be stored behind an iCloud/asset layer and referenced by identifier instead of being embedded in source code or Git history.

No bundled content library is included in the repository.

## First Xcode setup

1. Open `Lumen.xcodeproj`.
2. Select the `Lumen` target.
3. Under **Signing & Capabilities**, select your Apple Developer Team.
4. Confirm that the iCloud capability uses the container `iCloud.com.mbkurt06.lumen`.
5. Build first on one Apple device/simulator, then verify CloudKit sync with another signed-in device.

The Apple Developer Team identifier is intentionally not stored in the repository.
