package media

import (
	"image"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"

	"github.com/disintegration/imaging"
)

type Variant struct {
	Path      string `json:"path"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	MimeType  string `json:"mime_type"`
	SizeBytes int64  `json:"size_bytes"`
}

func (s *Service) generateVariants(storageKey string, img image.Image) (map[string]Variant, error) {
	baseDir := filepath.Join(s.uploadsDir, storageKey[:2], storageKey[2:4])
	if err := os.MkdirAll(baseDir, 0o755); err != nil {
		return nil, err
	}
	variants := map[string]Variant{}
	jpegVariants := []struct {
		name   string
		width  int
		height int
		mode   string
	}{
		{name: "content", width: 1600, height: 900, mode: "fit"},
		{name: "cover", width: 1200, height: 675, mode: "fill"},
		{name: "card", width: 800, height: 450, mode: "fill"},
	}
	for _, spec := range jpegVariants {
		var derivative image.Image
		if spec.mode == "fill" {
			derivative = imaging.Fill(img, spec.width, spec.height, imaging.Center, imaging.Lanczos)
		} else {
			derivative = imaging.Fit(img, spec.width, spec.height, imaging.Lanczos)
		}
		path := filepath.Join(baseDir, spec.name+".jpg")
		if err := saveJPEG(path, derivative); err != nil {
			return nil, err
		}
		variant, err := variantFor(path, s.uploadsDir, "image/jpeg")
		if err != nil {
			return nil, err
		}
		variants[spec.name] = variant
	}

	avatar := imaging.Fill(img, 400, 400, imaging.Center, imaging.Lanczos)
	avatarPath := filepath.Join(baseDir, "avatar.png")
	if err := savePNG(avatarPath, avatar); err != nil {
		return nil, err
	}
	variant, err := variantFor(avatarPath, s.uploadsDir, "image/png")
	if err != nil {
		return nil, err
	}
	variants["avatar"] = variant
	return variants, nil
}

func saveJPEG(path string, img image.Image) error {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()
	return jpeg.Encode(file, img, &jpeg.Options{Quality: 86})
}

func savePNG(path string, img image.Image) error {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()
	return png.Encode(file, img)
}

func variantFor(path string, uploadsDir string, mimeType string) (Variant, error) {
	info, err := os.Stat(path)
	if err != nil {
		return Variant{}, err
	}
	cfg, err := imaging.Open(path, imaging.AutoOrientation(true))
	if err != nil {
		return Variant{}, err
	}
	relative, err := filepath.Rel(uploadsDir, path)
	if err != nil {
		return Variant{}, err
	}
	return Variant{
		Path:      "/uploads/" + filepath.ToSlash(relative),
		Width:     cfg.Bounds().Dx(),
		Height:    cfg.Bounds().Dy(),
		MimeType:  mimeType,
		SizeBytes: info.Size(),
	}, nil
}
