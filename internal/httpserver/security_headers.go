package httpserver

import (
	"net/http"
	"strings"
)

func SecurityHeaders(production bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
			w.Header().Set("X-Frame-Options", "DENY")
			if production {
				w.Header().Set("Content-Security-Policy", productionCSP())
			}
			next.ServeHTTP(w, r)
		})
	}
}

func productionCSP() string {
	return strings.Join([]string{
		"default-src 'self';",
		"script-src 'self';",
		"style-src 'self';",
		"img-src 'self';",
		"font-src 'self';",
		"connect-src 'self';",
		"frame-ancestors 'none';",
		"base-uri 'self';",
		"form-action 'self';",
		"object-src 'none';",
	}, " ")
}

func containsDirective(csp string, directive string) bool {
	return strings.Contains(csp, directive)
}
