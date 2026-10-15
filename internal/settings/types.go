package settings

import "fmt"

// Parse limits (Architecture.md, "Parsing and limits").
const (
	// MaxFileSize is the largest accepted file, in bytes.
	MaxFileSize = 32 << 10
	// MaxNodes is the largest accepted YAML node count.
	MaxNodes = 2000
	// MaxDepth is the deepest accepted nesting; the top mapping is depth 1.
	MaxDepth = 8
	// MaxIncludes is the longest include list; the rest is dropped.
	MaxIncludes = 200
	// MaxRefBytes is the longest accepted reference.
	MaxRefBytes = 1024
)

// ParseError is a fatal parse problem. Line is 1-based, 0 when unknown, and
// never exceeds the number of lines in the input. Msg is safe to show.
type ParseError struct {
	Line int
	Msg  string
}

func (e *ParseError) Error() string {
	if e.Line > 0 {
		return fmt.Sprintf("line %d: %s", e.Line, e.Msg)
	}
	return e.Msg
}

// Ref is a raw, unresolved reference from an include item or open. Text is
// the unmodified string, Key the warning key path ("include[2]", "open"),
// and Line the 1-based YAML line.
type Ref struct {
	Text string `json:"text"`
	Key  string `json:"key"`
	Line int    `json:"line"`
}

// ReadTime holds the reading-time settings; only set fields are present.
type ReadTime struct {
	WPM             *int  `json:"wpm,omitempty"`
	IncludeHeadings *bool `json:"includeHeadings,omitempty"`
	IncludeCode     *bool `json:"includeCode,omitempty"`
}

// Settings is a sparse settings layer: only valid keys that were set.
type Settings struct {
	Theme        *string   `json:"theme,omitempty"`
	Style        *string   `json:"style,omitempty"`
	Font         *string   `json:"font,omitempty"`
	CodeFont     *string   `json:"codeFont,omitempty"`
	FontSize     *float64  `json:"fontSize,omitempty"`
	LineHeight   *float64  `json:"lineHeight,omitempty"`
	ContentWidth *string   `json:"contentWidth,omitempty"`
	MarkdownOnly *bool     `json:"markdownOnly,omitempty"`
	ShowHidden   *bool     `json:"showHidden,omitempty"`
	Sort         *string   `json:"sort,omitempty"`
	ReadTime     *ReadTime `json:"readTime,omitempty"`
}

// Project is a parsed project file. References are raw; the caller resolves
// them.
type Project struct {
	Name     *string
	Open     *Ref
	Include  []Ref
	Settings Settings
}

// Prefs is a parsed preferences file.
type Prefs struct {
	Settings Settings
}
