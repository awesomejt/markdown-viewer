// Package watch provides fsnotify and mtime polling for file change subscriptions.
//
// A [Hub] ref-counts subscriptions per (root, path): the first subscriber of a
// key starts one watcher, the last one to leave stops it. The watcher matches
// the root's configured mode: a poller for "poll" roots, a shared inotify
// instance for "fsnotify" roots. Every filesystem access goes through
// [fsroot.Handle], so timeouts and the in-flight cap apply.
//
// Event scheme. A watched path may be a file or a directory.
//   - File: "modified" when its content or metadata changes, "created" when it
//     appears, "deleted" when it goes away. The event path is the watched path.
//   - Directory: "created" and "deleted" are reported on the direct child's
//     path (root-relative), and "modified" on the directory itself whenever its
//     own mtime changes, which includes every child add or remove. A change to
//     a child's content does not touch the directory's mtime, so it is only
//     seen by subscribing to the child. The directory itself disappearing or
//     reappearing is reported as "deleted" or "created" on its own path.
//
// Events are coalesced per (root, path) within a short window, so a burst
// yields one event whose op merges the burst.
package watch
