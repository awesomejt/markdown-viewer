package api

import (
	"encoding/json"
	"testing"
)

func TestErrorDetailLineIsOptional(t *testing.T) {
	b, err := json.Marshal(errorBody{Error: errorDetail{Code: "c", Message: "m"}})
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != `{"error":{"code":"c","message":"m"}}` {
		t.Errorf("line not omitted when 0: %s", b)
	}
	b, err = json.Marshal(errorBody{Error: errorDetail{Code: "c", Message: "m", Line: 7}})
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != `{"error":{"code":"c","message":"m","line":7}}` {
		t.Errorf("line missing when set: %s", b)
	}
}
