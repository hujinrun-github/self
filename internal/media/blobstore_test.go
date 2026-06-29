package media

import "testing"

func TestLocalVariantObjectKey(t *testing.T) {
	storageKey := "aabbccddeeff00112233445566778899"

	t.Run("maps legacy image variants", func(t *testing.T) {
		cases := map[string]string{
			"content": "aa/bb/content.jpg",
			"cover":   "aa/bb/cover.jpg",
			"card":    "aa/bb/card.jpg",
			"avatar":  "aa/bb/avatar.png",
		}
		for variantName, want := range cases {
			got, err := localVariantObjectKey(storageKey, variantName, "")
			if err != nil {
				t.Fatalf("%s: %v", variantName, err)
			}
			if got != want {
				t.Fatalf("%s key = %q, want %q", variantName, got, want)
			}
		}
	})

	t.Run("reuses uploads-relative paths for non-image variants", func(t *testing.T) {
		got, err := localVariantObjectKey(storageKey, "original", "/uploads/audio/2026/06/demo/original.mp3")
		if err != nil {
			t.Fatalf("localVariantObjectKey: %v", err)
		}
		if got != "audio/2026/06/demo/original.mp3" {
			t.Fatalf("key = %q", got)
		}
	})
}

func TestNormalizeMinIOEndpoint(t *testing.T) {
	t.Run("keeps bare endpoint and explicit ssl setting", func(t *testing.T) {
		endpoint, secure, err := normalizeMinIOEndpoint("127.0.0.1:19000", false)
		if err != nil {
			t.Fatalf("normalizeMinIOEndpoint: %v", err)
		}
		if endpoint != "127.0.0.1:19000" {
			t.Fatalf("endpoint = %q", endpoint)
		}
		if secure {
			t.Fatal("secure = true, want false")
		}
	})

	t.Run("derives secure mode from https urls", func(t *testing.T) {
		endpoint, secure, err := normalizeMinIOEndpoint("https://minio.example.com:9443", false)
		if err != nil {
			t.Fatalf("normalizeMinIOEndpoint: %v", err)
		}
		if endpoint != "minio.example.com:9443" {
			t.Fatalf("endpoint = %q", endpoint)
		}
		if !secure {
			t.Fatal("secure = false, want true")
		}
	})

	t.Run("rejects path-prefixed urls", func(t *testing.T) {
		if _, _, err := normalizeMinIOEndpoint("https://minio.example.com/storage", false); err == nil {
			t.Fatal("expected path-prefixed endpoint to be rejected")
		}
	})
}
