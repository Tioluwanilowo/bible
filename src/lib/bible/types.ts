export interface BibleMetadata {
  version: string;
  name: string;
  abbreviation: string;
  language: string;
  publicDomain: boolean;
}

export interface BibleBook {
  id: string;
  name: string;
  chapters: number;
}

export interface BibleVerse {
  book: string;
  chapter: number;
  verse: number;
  text: string;
}

export interface ParsedReference {
  book: string;
  chapter: number;
  startVerse: number;
  endVerse?: number;
  version?: string;
  confidence: number;
}

export interface ParsingResult {
  originalText: string;
  normalizedText: string;
  reference: ParsedReference | null;
}
