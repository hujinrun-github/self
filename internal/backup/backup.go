package backup

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var (
	writeMu   sync.Mutex
	afterLock func()
)

func WithWriteLock(fn func() error) error {
	writeMu.Lock()
	defer writeMu.Unlock()
	return fn()
}

func Run(ctx context.Context, database *sql.DB, uploadsDir string, destinationDir string) error {
	start := time.Now().UTC()
	log.Printf("backup started at %s", start.Format(time.RFC3339))

	writeMu.Lock()
	defer writeMu.Unlock()
	if afterLock != nil {
		afterLock()
	}

	if err := ctx.Err(); err != nil {
		return err
	}
	if err := os.MkdirAll(destinationDir, 0o755); err != nil {
		return fmt.Errorf("create backup destination: %w", err)
	}

	dbSnapshot := filepath.Join(destinationDir, "portfolio.db")
	if err := os.RemoveAll(dbSnapshot); err != nil {
		return fmt.Errorf("remove previous database snapshot: %w", err)
	}
	if _, err := database.ExecContext(ctx, `VACUUM INTO '`+escapeSQLiteString(dbSnapshot)+`'`); err != nil {
		return fmt.Errorf("snapshot database: %w", err)
	}

	if err := copyTree(ctx, uploadsDir, filepath.Join(destinationDir, "uploads")); err != nil {
		return err
	}

	finish := time.Now().UTC()
	log.Printf("backup finished at %s", finish.Format(time.RFC3339))
	return nil
}

func escapeSQLiteString(value string) string {
	return strings.ReplaceAll(value, `'`, `''`)
}

func copyTree(ctx context.Context, source string, destination string) error {
	if _, err := os.Stat(source); os.IsNotExist(err) {
		return os.MkdirAll(destination, 0o755)
	}
	return filepath.WalkDir(source, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return fmt.Errorf("calculate relative upload path: %w", err)
		}
		target := filepath.Join(destination, relative)
		if entry.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		info, err := entry.Info()
		if err != nil {
			return fmt.Errorf("stat upload file: %w", err)
		}
		return copyFile(path, target, info.Mode())
	})
}

func copyFile(source string, destination string, mode fs.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return fmt.Errorf("create upload destination directory: %w", err)
	}
	in, err := os.Open(source)
	if err != nil {
		return fmt.Errorf("open upload source: %w", err)
	}
	defer in.Close()

	out, err := os.OpenFile(destination, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return fmt.Errorf("open upload destination: %w", err)
	}
	defer out.Close()

	if _, err := io.Copy(out, in); err != nil {
		return fmt.Errorf("copy upload file: %w", err)
	}
	return out.Close()
}
