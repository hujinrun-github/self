package content

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"portfolio/internal/i18n"
)

func engagementWriting(t *testing.T, repo *Repository) Writing {
	t.Helper()
	item, err := repo.CreateWriting(t.Context(), WritingInput{Title: "Interaction", ContentMD: "Body"})
	if err != nil {
		t.Fatal(err)
	}
	if err = repo.SetWritingStatus(t.Context(), item.ID, StatusPublished, nil); err != nil {
		t.Fatal(err)
	}
	return item
}

func visitorTestHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func TestEngagementLikesAreConcurrentDesiredStateAndRetainHistory(t *testing.T) {
	repo := newContentRepo(t)
	writing := engagementWriting(t, repo)
	if _, err := repo.db.Exec(`INSERT INTO writing_likes(writing_id,like_count) VALUES($1,7)`, writing.ID); err != nil {
		t.Fatal(err)
	}
	visitor := visitorTestHash("visitor-a")
	var wg sync.WaitGroup
	for range 16 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := repo.SetWritingLike(t.Context(), writing.ID, visitor, true); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	result, err := repo.WritingEngagement(t.Context(), writing.ID, visitor, 1, 10)
	if err != nil || result.LikeCount != 8 || !result.Liked {
		t.Fatalf("engagement=%+v error=%v", result, err)
	}
	for range 16 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := repo.SetWritingLike(t.Context(), writing.ID, visitor, false); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	result, err = repo.WritingEngagement(t.Context(), writing.ID, visitor, 1, 10)
	if err != nil || result.LikeCount != 7 || result.Liked {
		t.Fatalf("engagement=%+v error=%v", result, err)
	}
}

func TestEngagementViewsDeduplicateForRolling24Hours(t *testing.T) {
	repo := newContentRepo(t)
	now := time.Date(2026, 10, 2, 9, 0, 0, 0, time.UTC)
	repo.clock = func() time.Time { return now }
	writing := engagementWriting(t, repo)
	a, b := visitorTestHash("a"), visitorTestHash("b")
	var wg sync.WaitGroup
	for range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := repo.RecordWritingView(t.Context(), writing.ID, a); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	now = now.Add(23 * time.Hour)
	if _, err := repo.RecordWritingView(t.Context(), writing.ID, a); err != nil {
		t.Fatal(err)
	}
	now = now.Add(time.Hour)
	if _, err := repo.RecordWritingView(t.Context(), writing.ID, a); err != nil {
		t.Fatal(err)
	}
	totals, err := repo.RecordWritingView(t.Context(), writing.ID, b)
	if err != nil || totals.ViewCount != 3 || totals.VisitorCount != 2 {
		t.Fatalf("totals=%+v error=%v", totals, err)
	}
}

func TestEngagementCommentsModeratePaginateAndNeverExposeEmail(t *testing.T) {
	repo := newContentRepo(t)
	writing := engagementWriting(t, repo)
	first, err := repo.CreateWritingComment(t.Context(), writing.ID, WritingCommentInput{AuthorName: "Ada", Body: "待审核"})
	if err != nil || first.Status != "pending" {
		t.Fatalf("comment=%+v error=%v", first, err)
	}
	before, err := repo.WritingEngagement(t.Context(), writing.ID, visitorTestHash("a"), 1, 1)
	if err != nil || before.CommentCount != 0 || len(before.Comments) != 0 {
		t.Fatalf("unmoderated leak=%+v error=%v", before, err)
	}
	if _, err = repo.SetWritingCommentStatus(t.Context(), first.ID, "published"); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		c, e := repo.CreateWritingComment(t.Context(), writing.ID, WritingCommentInput{AuthorName: "Reader", Body: fmt.Sprint(i)})
		if e != nil {
			t.Fatal(e)
		}
		if _, e = repo.SetWritingCommentStatus(t.Context(), c.ID, "published"); e != nil {
			t.Fatal(e)
		}
	}
	if _, err = repo.db.Exec(`UPDATE writing_comments SET author_email='private@example.test' WHERE id=$1`, first.ID); err != nil {
		t.Fatal(err)
	}
	page, err := repo.WritingEngagement(t.Context(), writing.ID, visitorTestHash("a"), 1, 1)
	if err != nil || page.CommentCount != 3 || len(page.Comments) != 1 || !page.HasMore {
		t.Fatalf("page=%+v error=%v", page, err)
	}
	all, err := repo.WritingEngagement(t.Context(), writing.ID, visitorTestHash("a"), 1, 50)
	raw, _ := json.Marshal(all)
	if err != nil || strings.Contains(string(raw), "email") || strings.Contains(string(raw), "private@") || strings.Contains(string(raw), "visitor_hash") {
		t.Fatalf("public data leaked: %s err=%v", raw, err)
	}
	if _, err = repo.SetWritingCommentStatus(t.Context(), first.ID, "hidden"); err != nil {
		t.Fatal(err)
	}
	if err = repo.DeleteWritingComment(t.Context(), first.ID); err != nil {
		t.Fatal(err)
	}
	page, err = repo.WritingEngagement(t.Context(), writing.ID, visitorTestHash("a"), 1, 50)
	if err != nil || page.CommentCount != 2 {
		t.Fatalf("after delete=%+v err=%v", page, err)
	}
	stats, err := repo.WritingStats(t.Context(), 1, 20)
	if err != nil || stats.Summary.CommentCount != 2 || stats.Total != 1 {
		t.Fatalf("stats=%+v err=%v", stats, err)
	}
}

func engagementRequest(router http.Handler, method, path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://example.com")
	if cookie != nil {
		req.AddCookie(cookie)
	}
	out := httptest.NewRecorder()
	router.ServeHTTP(out, req)
	return out
}

func TestEngagementHTTPIdentityOriginLimitsAndModeration(t *testing.T) {
	repo := newContentRepo(t)
	writing := engagementWriting(t, repo)
	router := chi.NewRouter()
	RegisterSiteRoutes(router, repo, SiteEngagementOptions{VisitorSecret: strings.Repeat("s", 32)})
	RegisterAdminRoutes(router, repo)
	base := "/api/site/writing/" + writing.Slug
	init := engagementRequest(router, http.MethodGet, base+"/engagement", "", nil)
	if init.Code != 200 || len(init.Result().Cookies()) != 1 {
		t.Fatalf("init=%d %s", init.Code, init.Body.String())
	}
	cookie := init.Result().Cookies()[0]
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteLaxMode {
		t.Fatal("visitor cookie missing safety attributes")
	}
	if got := engagementRequest(router, http.MethodPost, base+"/like", `{"liked":true}`, nil); got.Code != 403 {
		t.Fatalf("missing cookie=%d", got.Code)
	}
	if got := engagementRequest(router, http.MethodPost, base+"/like", `{}`, cookie); got.Code != 400 {
		t.Fatalf("missing desired state=%d", got.Code)
	}
	req := httptest.NewRequest(http.MethodPost, base+"/like", strings.NewReader(`{"liked":true}`))
	req.AddCookie(cookie)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://evil.test")
	denied := httptest.NewRecorder()
	router.ServeHTTP(denied, req)
	if denied.Code != 403 {
		t.Fatalf("cross-site=%d", denied.Code)
	}
	badCookie := *cookie
	badCookie.Value += "tampered"
	if got := engagementRequest(router, http.MethodPost, base+"/like", `{"liked":true}`, &badCookie); got.Code != 403 {
		t.Fatalf("tampered cookie=%d", got.Code)
	}
	for range 2 {
		if got := engagementRequest(router, http.MethodPost, base+"/like", `{"liked":true}`, cookie); got.Code != 200 {
			t.Fatalf("like=%d %s", got.Code, got.Body.String())
		}
	}
	for range 2 {
		if got := engagementRequest(router, http.MethodPost, base+"/view", `{}`, cookie); got.Code != 200 {
			t.Fatalf("view=%d %s", got.Code, got.Body.String())
		}
	}
	comment := engagementRequest(router, http.MethodPost, base+"/comments", `{"author_name":"访客","body":"需要审核"}`, cookie)
	if comment.Code != 201 || !strings.Contains(comment.Body.String(), `"status":"pending"`) {
		t.Fatalf("comment=%d %s", comment.Code, comment.Body.String())
	}
	pending := engagementRequest(router, http.MethodGet, "/api/admin/comments?status=pending", "", nil)
	if pending.Code != 200 || !strings.Contains(pending.Body.String(), `"total":1`) {
		t.Fatalf("pending=%d %s", pending.Code, pending.Body.String())
	}
	for range 6 {
		comment = engagementRequest(router, http.MethodPost, base+"/comments", `{"author_name":"访客","body":"频率"}`, cookie)
	}
	if comment.Code != 429 {
		t.Fatalf("comment rate limit=%d", comment.Code)
	}
	if err := repo.SetWritingStatus(t.Context(), writing.ID, StatusArchived, nil); err != nil {
		t.Fatal(err)
	}
	if got := engagementRequest(router, http.MethodGet, base+"/engagement", "", cookie); got.Code != 404 {
		t.Fatalf("archived read=%d", got.Code)
	}
	if got := engagementRequest(router, http.MethodPost, base+"/like", `{"liked":false}`, cookie); got.Code != 404 {
		t.Fatalf("archived write=%d", got.Code)
	}
}

func TestEngagementHTTPPayloadAndAdminLifecycle(t *testing.T) {
	repo := newContentRepo(t)
	writing := engagementWriting(t, repo)
	router := chi.NewRouter()
	RegisterSiteRoutes(router, repo, SiteEngagementOptions{VisitorSecret: strings.Repeat("s", 32)})
	RegisterAdminRoutes(router, repo)
	base := "/api/site/writing/" + writing.Slug
	initial := engagementRequest(router, http.MethodGet, base+"/engagement", "", nil)
	cookie := initial.Result().Cookies()[0]
	for _, body := range []string{`null`, `{"liked":"yes"}`, `{"liked":true,"extra":1}`, `{"liked":true} {}`} {
		if got := engagementRequest(router, http.MethodPost, base+"/like", body, cookie); got.Code != 400 {
			t.Fatalf("invalid JSON %q status=%d", body, got.Code)
		}
	}
	if got := engagementRequest(router, http.MethodPost, base+"/comments", `{"author_name":"reader","body":"`+strings.Repeat("a", 9000)+`"}`, cookie); got.Code != 413 {
		t.Fatalf("oversize=%d", got.Code)
	}
	req := httptest.NewRequest(http.MethodPost, base+"/like", strings.NewReader(`{"liked":true}`))
	req.AddCookie(cookie)
	req.Header.Set("Origin", "http://example.com")
	req.Header.Set("Content-Type", "text/plain")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, req)
	if response.Code != 415 {
		t.Fatalf("nonJSON=%d", response.Code)
	}
	comment := engagementRequest(router, http.MethodPost, base+"/comments", `{"author_name":"reader","body":"正文"}`, cookie)
	var submitted WritingCommentSubmission
	if comment.Code != 201 || json.Unmarshal(comment.Body.Bytes(), &submitted) != nil {
		t.Fatalf("submit=%d %s", comment.Code, comment.Body.String())
	}
	commentPath := fmt.Sprintf("/api/admin/comments/%d", submitted.ID)
	for _, status := range []string{"published", "hidden", "pending"} {
		got := engagementRequest(router, http.MethodPatch, commentPath, fmt.Sprintf(`{"status":%q}`, status), nil)
		if got.Code != 200 {
			t.Fatalf("moderate=%d %s", got.Code, got.Body.String())
		}
		public := engagementRequest(router, http.MethodGet, base+"/engagement", "", cookie)
		var engagement WritingEngagement
		if err := json.Unmarshal(public.Body.Bytes(), &engagement); err != nil {
			t.Fatal(err)
		}
		want := int64(0)
		if status == "published" {
			want = 1
		}
		if engagement.CommentCount != want {
			t.Fatalf("status=%s public count=%d", status, engagement.CommentCount)
		}
	}
	if got := engagementRequest(router, http.MethodPatch, commentPath, `{"status":"spam"}`, nil); got.Code != 400 {
		t.Fatalf("invalid status=%d", got.Code)
	}
	if got := engagementRequest(router, http.MethodDelete, commentPath, "", nil); got.Code != 204 {
		t.Fatalf("delete=%d", got.Code)
	}
	if got := engagementRequest(router, http.MethodDelete, commentPath, "", nil); got.Code != 404 {
		t.Fatalf("repeat delete=%d", got.Code)
	}
	if got := engagementRequest(router, http.MethodGet, "/api/admin/writing/stats?page=1&limit=1", "", nil); got.Code != 200 {
		t.Fatalf("stats=%d %s", got.Code, got.Body.String())
	}
}

func TestEngagementSecureCookiesAndBoundedHashedRateLimit(t *testing.T) {
	service := newSiteEngagement([]SiteEngagementOptions{{VisitorSecret: strings.Repeat("s", 32), SecureCookies: true}})
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/api/site/writing/article/engagement", nil)
	out := httptest.NewRecorder()
	if _, err := service.establishVisitor(out, req); err != nil {
		t.Fatal(err)
	}
	if !out.Result().Cookies()[0].Secure {
		t.Fatal("TLS-terminated deployment requires Secure cookie")
	}
	for i := 0; i < 60; i++ {
		if !service.allowWrite(visitorTestHash(fmt.Sprint(i)), "192.0.2.99:1234", "comments") {
			t.Fatalf("normal distinct visitor %d rate-limited", i)
		}
	}
	if service.allowWrite(visitorTestHash("overflow"), "192.0.2.99:1234", "comments") {
		t.Fatal("IP comment limit was bypassed")
	}
	for key := range service.rates {
		if strings.Contains(key, "192.0.2.99") {
			t.Fatal("rate limiter retained raw IP")
		}
	}
	for i := 0; i < 5000; i++ {
		service.allowWrite(visitorTestHash(fmt.Sprint(i)), fmt.Sprintf("10.%d.%d.%d:1234", i/65536, (i/256)%256, i%256), "like")
	}
	if len(service.rates) > 4096 {
		t.Fatalf("rate entries unbounded: %d", len(service.rates))
	}
}

func TestEngagementRejectsDraftAndFutureArticlesAndCountsAllPages(t *testing.T) {
	repo := newContentRepo(t)
	now := time.Date(2026, 10, 2, 9, 0, 0, 0, time.UTC)
	repo.clock = func() time.Time { return now }
	public := engagementWriting(t, repo)
	draft, err := repo.CreateWriting(t.Context(), WritingInput{Title: "Draft"})
	if err != nil {
		t.Fatal(err)
	}
	future, err := repo.CreateWriting(t.Context(), WritingInput{Title: "Future"})
	if err != nil {
		t.Fatal(err)
	}
	later := now.Add(time.Hour)
	if err = repo.SetWritingStatus(t.Context(), future.ID, StatusPublished, &later); err != nil {
		t.Fatal(err)
	}
	visitor := visitorTestHash("private-article-check")
	for _, id := range []int64{draft.ID, future.ID} {
		if _, err = repo.WritingEngagement(t.Context(), id, visitor, 1, 10); !errors.Is(err, ErrNotFound) {
			t.Fatalf("private engagement err=%v", err)
		}
		if _, err = repo.SetWritingLike(t.Context(), id, visitor, true); !errors.Is(err, ErrNotFound) {
			t.Fatalf("private like err=%v", err)
		}
		if _, err = repo.RecordWritingView(t.Context(), id, visitor); !errors.Is(err, ErrNotFound) {
			t.Fatalf("private view err=%v", err)
		}
		if _, err = repo.CreateWritingComment(t.Context(), id, WritingCommentInput{AuthorName: "reader", Body: "comment"}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("private comment err=%v", err)
		}
	}
	for range 3 {
		if _, err = repo.CreateWritingComment(t.Context(), public.ID, WritingCommentInput{AuthorName: "reader", Body: "pending"}); err != nil {
			t.Fatal(err)
		}
	}
	comments, err := repo.ListWritingComments(t.Context(), "pending", public.ID, 2, 1)
	if err != nil || comments.Total != 3 || len(comments.Items) != 1 || !comments.HasMore {
		t.Fatalf("admin pagination=%+v err=%v", comments, err)
	}
	stats, err := repo.WritingStats(t.Context(), 1, 1)
	if err != nil || stats.Total != 3 || len(stats.Items) != 1 || !stats.HasMore || stats.Summary.PendingCommentCount != 3 {
		t.Fatalf("stats pagination=%+v err=%v", stats, err)
	}
}

func TestEngagementLocalesShareVisitorReadsAndLikes(t *testing.T) {
	repo := newContentRepo(t)
	writing := engagementWriting(t, repo)
	for _, locale := range []i18n.Locale{i18n.LocaleEN, i18n.LocaleJA} {
		input := WritingTranslationInput{Title: "Translated article", Slug: "interaction-" + string(locale), ContentMD: "Translated body"}
		if err := repo.SaveWritingTranslation(t.Context(), writing.ID, locale, input, "", "*"); err != nil {
			t.Fatalf("save %s translation: %v", locale, err)
		}
	}
	admin, err := repo.GetWritingAdmin(t.Context(), writing.ID)
	if err != nil {
		t.Fatal(err)
	}
	english := admin.Translations["en"]
	if english.ETag == nil {
		t.Fatal("English translation has no review ETag")
	}
	if err = repo.MarkWritingTranslationReviewed(t.Context(), writing.ID, i18n.LocaleEN, *english.ETag); err != nil {
		t.Fatalf("review English translation: %v", err)
	}
	router := chi.NewRouter()
	RegisterSiteRoutes(router, repo, SiteEngagementOptions{VisitorSecret: strings.Repeat("s", 32)})
	zhBase := "/api/site/writing/" + writing.Slug
	initial := engagementRequest(router, http.MethodGet, zhBase+"/engagement?locale=zh", "", nil)
	if initial.Code != http.StatusOK || len(initial.Result().Cookies()) != 1 {
		t.Fatalf("Chinese initialization=%d %s", initial.Code, initial.Body.String())
	}
	cookie := initial.Result().Cookies()[0]
	for _, variant := range []struct{ slug, locale string }{{writing.Slug, "zh"}, {"interaction-en", "en"}} {
		base := "/api/site/writing/" + variant.slug
		viewResponse := engagementRequest(router, http.MethodPost, base+"/view?locale="+variant.locale, `{}`, cookie)
		var views WritingViewResult
		if viewResponse.Code != http.StatusOK || json.Unmarshal(viewResponse.Body.Bytes(), &views) != nil || views.ViewCount != 1 || views.VisitorCount != 1 {
			t.Fatalf("%s shared reads=%d %s", variant.locale, viewResponse.Code, viewResponse.Body.String())
		}
		likeResponse := engagementRequest(router, http.MethodPost, base+"/like?locale="+variant.locale, `{"liked":true}`, cookie)
		var likes WritingLikeResult
		if likeResponse.Code != http.StatusOK || json.Unmarshal(likeResponse.Body.Bytes(), &likes) != nil || likes.LikeCount != 1 || !likes.Liked {
			t.Fatalf("%s shared likes=%d %s", variant.locale, likeResponse.Code, likeResponse.Body.String())
		}
		read := engagementRequest(router, http.MethodGet, base+"/engagement?locale="+variant.locale, "", cookie)
		var engagement WritingEngagement
		if read.Code != http.StatusOK || json.Unmarshal(read.Body.Bytes(), &engagement) != nil || engagement.ViewCount != 1 || engagement.VisitorCount != 1 || engagement.LikeCount != 1 || !engagement.Liked {
			t.Fatalf("%s shared engagement=%d %s", variant.locale, read.Code, read.Body.String())
		}
		if len(read.Result().Cookies()) != 0 {
			t.Fatalf("%s replaced existing visitor identity", variant.locale)
		}
	}
	for _, action := range []struct{ method, path, body string }{
		{http.MethodGet, "/engagement", ""}, {http.MethodPost, "/view", `{}`}, {http.MethodPost, "/like", `{"liked":true}`},
	} {
		response := engagementRequest(router, action.method, "/api/site/writing/interaction-ja"+action.path+"?locale=ja", action.body, cookie)
		if response.Code != http.StatusNotFound {
			t.Fatalf("unreviewed Japanese %s=%d %s", action.path, response.Code, response.Body.String())
		}
	}
	var visitorRows, likeRows int
	if err = repo.db.QueryRow(`SELECT (SELECT COUNT(*) FROM writing_visitors WHERE writing_id=$1),(SELECT COUNT(*) FROM writing_visitor_likes WHERE writing_id=$1)`, writing.ID).Scan(&visitorRows, &likeRows); err != nil {
		t.Fatal(err)
	}
	if visitorRows != 1 || likeRows != 1 {
		t.Fatalf("locale identities split: visitor rows=%d like rows=%d", visitorRows, likeRows)
	}
}
