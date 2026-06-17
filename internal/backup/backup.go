package backup

import (
	"context"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var (
	writeMu          sync.Mutex
	afterLock        func()
	lookupPGDumpPath = defaultPGDumpPath
	runPGDump        = defaultRunPGDump
)

func WithWriteLock(fn func() error) error {
	writeMu.Lock()
	defer writeMu.Unlock()
	return fn()
}

func Run(ctx context.Context, databaseURL string, uploadsDir string, destinationDir string) error {
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

	dbSnapshot := filepath.Join(destinationDir, "database.dump")
	if err := os.RemoveAll(dbSnapshot); err != nil {
		return fmt.Errorf("remove previous database snapshot: %w", err)
	}
	pgDumpPath, err := lookupPGDumpPath()
	if err != nil {
		return fmt.Errorf("locate pg_dump: %w", err)
	}
	args, env, err := pgDumpInvocation(databaseURL, dbSnapshot)
	if err != nil {
		return err
	}
	if err := runPGDump(ctx, pgDumpPath, args, env); err != nil {
		return fmt.Errorf("snapshot database: %w", err)
	}

	if err := copyTree(ctx, uploadsDir, filepath.Join(destinationDir, "uploads")); err != nil {
		return err
	}

	finish := time.Now().UTC()
	log.Printf("backup finished at %s", finish.Format(time.RFC3339))
	return nil
}

func pgDumpInvocation(databaseURL string, destination string) ([]string, []string, error) {
	sanitizedURL, password, err := sanitizeDatabaseURL(databaseURL)
	if err != nil {
		return nil, nil, fmt.Errorf("invalid database url: %w", err)
	}
	args := []string{
		"--format=custom",
		"--no-owner",
		"--no-acl",
		"--file",
		destination,
		sanitizedURL,
	}
	env := os.Environ()
	if password != "" {
		env = append(env, "PGPASSWORD="+password)
	}
	return args, env, nil
}

func sanitizeDatabaseURL(raw string) (string, string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", "", err
	}
	if parsed.Scheme != "postgres" && parsed.Scheme != "postgresql" {
		return "", "", fmt.Errorf("unsupported scheme %q", parsed.Scheme)
	}
	if parsed.Host == "" {
		return "", "", fmt.Errorf("host is required")
	}
	if parsed.Path == "" || parsed.Path == "/" {
		return "", "", fmt.Errorf("database name is required")
	}

	password := ""
	if parsed.User != nil {
		username := parsed.User.Username()
		password, _ = parsed.User.Password()
		parsed.User = url.User(username)
	}
	return parsed.String(), password, nil
}

func defaultPGDumpPath() (string, error) {
	if path := strings.TrimSpace(os.Getenv("PG_DUMP_PATH")); path != "" {
		return path, nil
	}
	return exec.LookPath("pg_dump")
}

func defaultRunPGDump(ctx context.Context, path string, args []string, env []string) error {
	cmd := exec.CommandContext(ctx, path, args...)
	cmd.Env = env
	output, err := cmd.CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if message != "" {
			return fmt.Errorf("%w: %s", err, message)
		}
		return err
	}
	return nil
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
