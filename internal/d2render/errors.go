package d2render

import "errors"

var (
	// ErrBusy means no render slot became free within the slot wait.
	ErrBusy = errors.New("d2render: no render slot available")
	// ErrTimeout means the render exceeded the render timeout.
	ErrTimeout = errors.New("d2render: render timed out")
)

// CompileError is a D2 compile failure. Msg is the D2 error text, which
// contains line:col positions and never host paths.
type CompileError struct{ Msg string }

func (e *CompileError) Error() string { return e.Msg }

// BadRequestError reports an invalid theme or layout.
type BadRequestError struct{ Msg string }

func (e *BadRequestError) Error() string { return e.Msg }
