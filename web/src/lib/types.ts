export type MediaVariant = {
  url: string;
  width: number;
  height: number;
  mime_type: string;
};

export type MediaMap = Record<string, Record<string, MediaVariant>>;

export type APIError = {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
};
