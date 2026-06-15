package httpserver

import (
	"encoding/json"
	"net/http"
)

type APIError struct {
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields,omitempty"`
}

func WriteJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func WriteError(w http.ResponseWriter, status int, code string, message string, fields map[string]string) {
	WriteJSON(w, status, map[string]APIError{
		"error": {
			Code:    code,
			Message: message,
			Fields:  fields,
		},
	})
}
