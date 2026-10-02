import { useEffect, useRef, useState } from "react";

import { apiFetch } from "../../lib/api";
import type { CommentSubmission, WritingEngagement } from "../../lib/engagement";
import { type Locale, withLocaleQuery } from "./locale";

type EngagementState = {
  key: string;
  data: WritingEngagement | null;
  loading: boolean;
  liking: boolean;
  submitting: boolean;
  loadingMore: boolean;
  loadError: boolean;
  likeError: boolean;
  commentError: boolean;
  pageError: boolean;
  viewError: boolean;
  commentSent: boolean;
};

function initialState(key: string): EngagementState {
  return { key, data: null, loading: true, liking: false, submitting: false, loadingMore: false, loadError: false, likeError: false, commentError: false, pageError: false, viewError: false, commentSent: false };
}

type RequestScope = {
  key: string;
  reload: () => Promise<void>;
  toggleLike: () => Promise<void>;
  loadMore: () => Promise<void>;
  registerView: () => Promise<void>;
  submitComment: (authorName: string, body: string) => Promise<boolean>;
};

export type WritingEngagementController = ReturnType<typeof useWritingEngagement>;

export function useWritingEngagement(slug: string, locale: Locale, enabled: boolean) {
  const key = `${locale}:${slug}`;
  const [state, setState] = useState<EngagementState>(() => initialState(key));
  const scopeRef = useRef<RequestScope | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const endpoint = `/api/site/writing/${encodeURIComponent(slug)}`;
    let data: WritingEngagement | null = null;
    let loading = false, liking = false, submitting = false, loadingMore = false, viewing = false, viewed = false;
    const active = () => !controller.signal.aborted;
    function update(patch: Partial<EngagementState>) {
      if (active()) setState((current) => ({ ...(current.key === key ? current : initialState(key)), ...patch }));
    }
    function updateData(transform: (current: WritingEngagement) => WritingEngagement) {
      if (!active() || !data) return;
      data = transform(data);
      update({ data });
    }
    const request = <T,>(path: string, init: RequestInit = {}) => apiFetch<T>(withLocaleQuery(`${endpoint}${path}`, locale), { ...init, signal: controller.signal });

    async function registerView() {
      if (!active() || !data || viewing || viewed || document.visibilityState !== "visible") return;
      viewing = true;
      update({ viewError: false });
      try {
        const result = await request<Pick<WritingEngagement, "view_count" | "visitor_count">>("/view", { method: "POST", body: JSON.stringify({}) });
        if (!active()) return;
        viewed = true;
        updateData((current) => ({ ...current, ...result }));
      } catch {
        update({ viewError: true });
      } finally {
        viewing = false;
      }
    }

    async function reload() {
      if (!active() || loading) return;
      loading = true;
      update({ loading: true, loadError: false });
      try {
        const result = await request<WritingEngagement>("/engagement?page=1&limit=10");
        if (!active()) return;
        data = result;
        update({ data, loading: false });
        await registerView();
      } catch {
        update({ loading: false, loadError: true });
      } finally {
        loading = false;
      }
    }

    async function toggleLike() {
      if (!active() || !data || liking) return;
      liking = true;
      update({ liking: true, likeError: false });
      try {
        const result = await request<Pick<WritingEngagement, "liked" | "like_count">>("/like", { method: "POST", body: JSON.stringify({ liked: !data.liked }) });
        updateData((current) => ({ ...current, ...result }));
      } catch {
        update({ likeError: true });
      } finally {
        liking = false;
        update({ liking: false });
      }
    }

    async function loadMore() {
      if (!active() || !data?.has_more || loadingMore) return;
      loadingMore = true;
      update({ loadingMore: true, pageError: false });
      try {
        const result = await request<WritingEngagement>(`/engagement?page=${data.page + 1}&limit=${data.limit}`);
        updateData((current) => {
          const comments = new Map(current.comments.map((comment) => [comment.id, comment]));
          result.comments.forEach((comment) => comments.set(comment.id, comment));
          return { ...current, comments: [...comments.values()], comment_count: result.comment_count, page: result.page, limit: result.limit, has_more: result.has_more };
        });
      } catch {
        update({ pageError: true });
      } finally {
        loadingMore = false;
        update({ loadingMore: false });
      }
    }

    async function submitComment(authorName: string, body: string) {
      if (!active() || !data || submitting || !authorName.trim() || !body.trim() || Array.from(authorName.trim()).length > 80 || Array.from(body.trim()).length > 1000) return false;
      submitting = true;
      update({ submitting: true, commentError: false, commentSent: false });
      try {
        const result = await request<CommentSubmission>("/comments", { method: "POST", body: JSON.stringify({ author_name: authorName.trim(), body: body.trim() }) });
        if (!active()) return false;
        if (result.status !== "pending") throw new Error("Unexpected comment status");
        update({ commentSent: true });
        return true;
      } catch {
        update({ commentError: true });
        return false;
      } finally {
        submitting = false;
        update({ submitting: false });
      }
    }

    scopeRef.current = { key, reload, toggleLike, loadMore, registerView, submitComment };
    const onVisibilityChange = () => { if (!viewed) void registerView(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    void reload();
    return () => {
      controller.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (scopeRef.current?.key === key) scopeRef.current = null;
    };
  }, [enabled, key, locale, slug]);

  const current = enabled && state.key === key ? state : initialState(key);
  const activeScope = () => enabled && scopeRef.current?.key === key ? scopeRef.current : null;
  return {
    ...current,
    reload: () => activeScope()?.reload(),
    toggleLike: () => activeScope()?.toggleLike(),
    loadMore: () => activeScope()?.loadMore(),
    registerView: () => activeScope()?.registerView(),
    submitComment: (authorName: string, body: string) => activeScope()?.submitComment(authorName, body) ?? Promise.resolve(false),
  };
}
