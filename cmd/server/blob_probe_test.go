package main

import (
	"context"
	"testing"

	"portfolio/internal/media"
)

func TestUsesHybridBlobBackendIsCaseInsensitive(t *testing.T) {
	if !usesHybridBlobBackend("Hybrid") {
		t.Fatal("expected mixed-case Hybrid backend to be treated as hybrid")
	}
	if usesHybridBlobBackend("local") {
		t.Fatal("did not expect local backend to be treated as hybrid")
	}
}

func TestNewBlobStoreProbeSupportsMixedCaseHybridMode(t *testing.T) {
	probe := newBlobStoreProbe("Hybrid", media.NewLocalBlobStore(t.TempDir()), "_healthchecks/mixed-case")
	if probe == nil {
		t.Fatal("expected blob probe for mixed-case Hybrid backend")
	}
	if err := probe(context.Background()); err != nil {
		t.Fatalf("probe returned error: %v", err)
	}
}

func TestNewBlobStoreProbeReturnsNilWhenHybridStoreIsMissing(t *testing.T) {
	probe := newBlobStoreProbe("Hybrid", nil, "_healthchecks/missing-store")
	if probe != nil {
		t.Fatal("expected nil blob probe when hybrid store is missing")
	}
}
