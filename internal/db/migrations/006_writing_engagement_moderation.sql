ALTER TABLE writing_comments DROP CONSTRAINT writing_comments_status_check;
ALTER TABLE writing_comments ADD CONSTRAINT writing_comments_status_check CHECK (status IN ('pending', 'published', 'hidden'));
ALTER TABLE writing_comments ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE writing_comments ADD COLUMN updated_at TIMESTAMPTZ;
UPDATE writing_comments SET updated_at = created_at;
ALTER TABLE writing_comments ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE writing_comments ALTER COLUMN updated_at SET DEFAULT now();
CREATE INDEX idx_writing_comments_moderation ON writing_comments(status, created_at DESC, id DESC);
CREATE TABLE writing_visitor_likes (
  writing_id BIGINT NOT NULL REFERENCES writings(id) ON DELETE CASCADE,
  visitor_hash TEXT NOT NULL CHECK (length(visitor_hash) = 64),
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (writing_id, visitor_hash)
);
CREATE TABLE writing_visitors (
  writing_id BIGINT NOT NULL REFERENCES writings(id) ON DELETE CASCADE,
  visitor_hash TEXT NOT NULL CHECK (length(visitor_hash) = 64),
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_viewed_at TIMESTAMPTZ NOT NULL,
  view_count BIGINT NOT NULL DEFAULT 1 CHECK (view_count >= 1),
  PRIMARY KEY (writing_id, visitor_hash)
);
