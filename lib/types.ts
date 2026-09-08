export const SECTIONS = ["global", "tech", "innovators", "early", "creators", "universe", "history"] as const;
export type Section = typeof SECTIONS[number];

export type ContentItem = {
  id: string;
  section: Section;
  title: string;
  summary: string;
  aiSummary?: string;
  sourceName: string;
  url: string;
  country?: string;
  topics: string[];
  publishedAt: string;
  createdAt: string;
  score: number;
};
