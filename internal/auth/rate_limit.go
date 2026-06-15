package auth

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

type RateLimiter struct {
	mu       sync.Mutex
	limit    int
	window   time.Duration
	attempts map[string][]time.Time
}

func NewRateLimiter(limit int, window time.Duration) *RateLimiter {
	return &RateLimiter{
		limit:    limit,
		window:   window,
		attempts: map[string][]time.Time{},
	}
}

func (r *RateLimiter) Allow(key string, now time.Time) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.prune(key, now)
	return len(r.attempts[key]) < r.limit
}

func (r *RateLimiter) RecordFailure(key string, now time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.prune(key, now)
	r.attempts[key] = append(r.attempts[key], now)
}

func (r *RateLimiter) Reset(key string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.attempts, key)
}

func (r *RateLimiter) prune(key string, now time.Time) {
	cutoff := now.Add(-r.window)
	values := r.attempts[key]
	kept := values[:0]
	for _, value := range values {
		if value.After(cutoff) {
			kept = append(kept, value)
		}
	}
	if len(kept) == 0 {
		delete(r.attempts, key)
		return
	}
	r.attempts[key] = kept
}

func loginKey(r *http.Request, email string) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	return strings.ToLower(strings.TrimSpace(host + "|" + email))
}
