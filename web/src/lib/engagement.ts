export type CommentStatus = "pending" | "published" | "hidden";

export interface PublicComment {
  id: number;
  author_name: string;
  body: string;
  created_at: string;
}

export interface WritingEngagement {
  like_count: number;
  liked: boolean;
  view_count: number;
  visitor_count: number;
  comment_count: number;
  comments: PublicComment[];
  page: number;
  limit: number;
  has_more: boolean;
}

export interface CommentSubmission extends PublicComment {
  status: "pending";
}

export interface AdminComment extends PublicComment {
  writing_id: number;
  writing_title: string;
  writing_slug: string;
  status: CommentStatus;
  updated_at: string;
}

export interface EngagementTotals {
  view_count: number;
  visitor_count: number;
  like_count: number;
  comment_count: number;
  pending_comment_count: number;
}

export interface WritingStats extends EngagementTotals {
  writing_id: number;
  title: string;
  slug: string;
  status: string;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
}

export interface WritingStatsResult extends PageResult<WritingStats> {
  summary: EngagementTotals;
}
