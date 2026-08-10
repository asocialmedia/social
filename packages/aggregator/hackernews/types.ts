export interface HNStory {
  by: string;
  descendants: number;
  id: number;
  score: number;
  time: number;
  title: string;
  type: string;
  url?: string;
}

export interface FetchStoriesOptions {
  identifier?: string;
  limit: number;
  page: number;
  search?: string;
  sort?: string;
  type?: string;
}

export interface HNApiResponse {
  hasMore: boolean;
  stories: HNStory[];
  total: number;
}

export class HackerNewsError extends Error {
  statusCode = 500;

  constructor(
    message: string,
    options: { cause?: unknown; statusCode?: number } = {}
  ) {
    super(message, options);
    this.name = "HackerNewsError";
    this.statusCode = options.statusCode ?? 500;
  }
}
