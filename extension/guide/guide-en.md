# GUGA Knowledge · User guide

## 1. Capture and organize

Open the extension sidebar to write notes, capture visible page screenshots, edit Todo / Idea or create web groups. Select text and use the context menu or Alt + Shift + S to capture it. Records are saved offline in this browser. Images can be pasted with Ctrl+V or added as files; recording requires microphone permission. Wait for attachments to finish saving.

Drag tags onto records and records into projects. A record may belong to several projects. Projects have descriptions, subprojects and relationship graphs. Tag names, descriptions and colors sync too. Filter Organized records by project membership to find unused material.

## 2. Start page and sorting

When the extension is enabled, GUGA is your browser’s new-tab page through Chrome’s URL Overrides API. Open a tab with + or Ctrl+T. Settings & data → Start page shows the status and favorite card count.

The start page shows complete, independently scrollable Todo / Idea lists. Enter `---` to add a divider; use the × at the end of a row to delete it. The lists share your existing data and sync normally. Pin a record from the organizer or its start-page preview to keep it first and show it above favorites on the start page. You can unpin it at any time. The page also shows 5 / 8 / 10 recent favorite pages, unread web groups and project cards. Click a project to see its records and subprojects. Open a record to preview it, then use Edit record for the full editor. Click outside a dialog to close it. Add up to 12 sites to the Dock; manage them to edit, reorder or remove them.

Sort the organizer by creation, modification, tag, project or title. Edits keep the current card position. Reopen, reload or click Re-sort to apply changed values. Changing filters or sort mode recalculates order. Lists and pinned records stay first.

## 3. Web groups

Drag a page title or its ⠿ handle to another group to move one page and keep its read status. Drag the group title, blank card area or Whole group handle to move the entire record into projects or tags, or merge all pages into another group. Duplicate URLs merge. Source notes and organization remain. Click a page handle to choose a destination without dragging.

## 4. Google Drive

Sign in with your own Google account. New users create a data folder; a new device chooses the existing folder created by this edition under the same account, then downloads. Use Open Google Drive folder to inspect it.

Download reads cloud changes into the browser; upload sends local changes. Neither starts the other automatically. Each record and project is a JSON file; tag definitions use tags.json and attachments are separate. Unchanged files use a verified cache. Update all devices before organizing cloud folders. Review conflicts, choose a version and download to apply; upload afterward when keeping your local version.

Deleting a cloud file does not delete its browser copy. Missing attachments or project references may block downloads. Restore missing files from Drive trash. Signing out keeps local records. Use separate Chrome profiles for different accounts or libraries.

## 5. Backup and preferences

Export a full ZIP before uninstalling. Choose grouping by project, tag or none. Markdown uses readable original names; project hierarchy and attachment links are preserved. Multiple memberships create reading copies, while restore data stays unique. Restore from the complete ZIP, not externally edited Markdown. JSON alone excludes attachment files. Imports stay local until you upload.

Settings includes themes, fonts, companions, website permissions and language. Choose English, 中文, Français or 日本語 and Apply language. The current page reloads after saving its sidebar draft; refresh other open pages to apply. Dock sites sync to your Google Drive when you manually upload or download, and complete ZIP backups include them. Concurrent Dock changes are offered for conflict resolution. Language, themes and the favorite-card count remain local browser preferences. Your own content is never translated. Google credentials are never included in backups. Keep the same extension directory and reload when updating; do not uninstall first.
