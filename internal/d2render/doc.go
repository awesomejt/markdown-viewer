// Package d2render compiles and renders D2 source to SVG with an LRU cache
// (including negative caching), a bounded number of concurrent renders, and a
// wall-clock render timeout. See docs/Architecture.md, "D2 Safety".
package d2render
