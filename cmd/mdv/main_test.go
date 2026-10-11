package main

import (
	"testing"
)

func TestVersionString(t *testing.T) {
	result := versionString()
	expected := "mdv dev"
	if result != expected {
		t.Errorf("versionString() = %q, want %q", result, expected)
	}
}
