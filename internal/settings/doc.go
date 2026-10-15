// Package settings parses project files (*.mdv.yaml) and global preferences
// (MDV_PREFS) into sparse, JSON-ready structs.
//
// The package is pure: it takes bytes and returns values, warnings and errors.
// It never touches the filesystem or the network, and it never hands a reader
// to the YAML decoder (library errors embed reader errors, which can contain
// host paths). Lexical reference rules (".." escapes, cross-root syntax, joins)
// belong to the caller; this package only checks that a reference is a
// non-empty string of bounded length.
//
// Hostile input is bounded by a size cap, a node cap, a depth cap, and a
// pre-check that refuses aliases, anchors, explicit tags, merge keys and more
// than one document. Every panic in the decoder becomes a [ParseError].
package settings
