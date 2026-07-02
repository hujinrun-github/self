package health

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestServiceHandlerChecksBlobStoreInHybridMode(t *testing.T) {
	dbCalls := 0
	blobCalls := 0
	service := NewService("hybrid",
		func(context.Context) error {
			dbCalls++
			return nil
		},
		func(context.Context) error {
			blobCalls++
			return nil
		},
	)

	recorder := httptest.NewRecorder()
	service.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/health", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	if dbCalls != 1 {
		t.Fatalf("db probe calls = %d, want 1", dbCalls)
	}
	if blobCalls != 1 {
		t.Fatalf("blob probe calls = %d, want 1", blobCalls)
	}
	if got := recorder.Header().Get("Content-Type"); !strings.HasPrefix(got, "application/json") {
		t.Fatalf("content-type = %q, want application/json", got)
	}

	var body struct {
		OK bool `json:"ok"`
	}
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !body.OK {
		t.Fatal("expected ok response")
	}
}

func TestServiceHandlerSkipsBlobStoreOutsideHybridMode(t *testing.T) {
	dbCalls := 0
	blobCalls := 0
	service := NewService("local",
		func(context.Context) error {
			dbCalls++
			return nil
		},
		func(context.Context) error {
			blobCalls++
			return nil
		},
	)

	recorder := httptest.NewRecorder()
	service.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/health", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	if dbCalls != 1 {
		t.Fatalf("db probe calls = %d, want 1", dbCalls)
	}
	if blobCalls != 0 {
		t.Fatalf("blob probe calls = %d, want 0", blobCalls)
	}
}

func TestServiceHandlerReturnsServiceUnavailableWhenDependencyFails(t *testing.T) {
	blobCalls := 0
	service := NewService("hybrid",
		func(context.Context) error {
			return errors.New("db down")
		},
		func(context.Context) error {
			blobCalls++
			return nil
		},
	)

	recorder := httptest.NewRecorder()
	service.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/health", nil))

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusServiceUnavailable)
	}
	if blobCalls != 0 {
		t.Fatalf("blob probe calls = %d, want 0", blobCalls)
	}
	if got := recorder.Header().Get("Content-Type"); !strings.HasPrefix(got, "application/json") {
		t.Fatalf("content-type = %q, want application/json", got)
	}
}
