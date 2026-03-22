import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useStore } from '../store/useStore';
import {
  parseReference,
  getScripture,
  getBookNames,
  getChapterCount,
  getLastVerseInChapter,
} from '../lib/bibleEngine';

type Suggestion = {
  id: string;
  label: string;
  value: string;
  helper: string;
};

function refLabel(book: string, chapter: number, verse: number, endVerse?: number): string {
  return `${book} ${chapter}:${verse}${endVerse ? `-${endVerse}` : ''}`;
}

export default function ManualSearch() {
  const [query, setQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [books, setBooks] = useState<string[]>([]);
  const rootRef = useRef<HTMLFormElement | null>(null);

  const { version, setPreview, logActivity, history } = useStore();

  useEffect(() => {
    setBooks(getBookNames(version));
  }, [version]);

  const runSearch = (raw: string): boolean => {
    const trimmed = raw.trim();
    if (!trimmed) return false;

    const parsed = parseReference(trimmed);
    if (parsed) {
      const scripture = getScripture(parsed.book, parsed.chapter, parsed.verse, version, parsed.endVerse);
      if (scripture) {
        setPreview(scripture);
        logActivity(`Manual lookup: ${refLabel(scripture.book, scripture.chapter, scripture.verse, scripture.endVerse)}`);
        setQuery('');
        setShowSuggestions(false);
        return true;
      }
      logActivity(`Verse not found: ${refLabel(parsed.book, parsed.chapter, parsed.verse, parsed.endVerse)}`, 'warning');
      return false;
    }

    logActivity(`Invalid reference format: ${trimmed}`, 'warning');
    return false;
  };

  const suggestions = useMemo<Suggestion[]>(() => {
    const trimmed = query.trim();
    const list: Suggestion[] = [];
    const seen = new Set<string>();

    const push = (item: Suggestion) => {
      if (seen.has(item.value)) return;
      seen.add(item.value);
      list.push(item);
    };

    if (!trimmed) {
      const recent = history.slice(0, 6);
      for (const scripture of recent) {
        const value = refLabel(scripture.book, scripture.chapter, scripture.verse, scripture.endVerse);
        push({
          id: `recent-${value}`,
          label: value,
          value,
          helper: 'Recent',
        });
      }
      return list;
    }

    const parsed = parseReference(trimmed);
    if (parsed) {
      const scripture = getScripture(parsed.book, parsed.chapter, parsed.verse, version, parsed.endVerse);
      if (scripture) {
        const value = refLabel(scripture.book, scripture.chapter, scripture.verse, scripture.endVerse);
        push({
          id: `exact-${value}`,
          label: value,
          value,
          helper: 'Exact match',
        });
      }
    }

    const lower = trimmed.toLowerCase();
    for (const book of books) {
      const bookLower = book.toLowerCase();
      if (bookLower.startsWith(lower) || bookLower.includes(lower)) {
        const value = `${book} 1:1`;
        push({
          id: `book-${book}`,
          label: value,
          value,
          helper: 'Book quick start',
        });
      }
      if (list.length >= 8) break;
    }

    const exactBook = books.find((book) => {
      const bookLower = book.toLowerCase();
      return lower === bookLower || lower.startsWith(`${bookLower} `);
    });

    if (exactBook) {
      const chapterCount = getChapterCount(exactBook, version) ?? 150;
      const rest = trimmed.slice(exactBook.length).trim();

      if (!rest) {
        for (let chapter = 1; chapter <= Math.min(chapterCount, 6); chapter++) {
          const value = `${exactBook} ${chapter}:1`;
          push({
            id: `chapter-${exactBook}-${chapter}`,
            label: value,
            value,
            helper: 'Chapter',
          });
        }
      } else {
        const chapterVerse = rest.match(/^(\d{1,3})(?::(\d{0,3}))?$/);
        if (chapterVerse) {
          const chapter = parseInt(chapterVerse[1], 10);
          if (chapter >= 1 && chapter <= chapterCount) {
            const verseFragment = chapterVerse[2];
            const maxVerse = getLastVerseInChapter(exactBook, chapter, version) ?? 1;

            if (verseFragment === undefined) {
              for (let verse = 1; verse <= Math.min(maxVerse, 8); verse++) {
                const value = `${exactBook} ${chapter}:${verse}`;
                push({
                  id: `verse-${exactBook}-${chapter}-${verse}`,
                  label: value,
                  value,
                  helper: 'Verse',
                });
              }
            } else if (verseFragment.length === 0) {
              for (let verse = 1; verse <= Math.min(maxVerse, 8); verse++) {
                const value = `${exactBook} ${chapter}:${verse}`;
                push({
                  id: `verse-colon-${exactBook}-${chapter}-${verse}`,
                  label: value,
                  value,
                  helper: 'Verse',
                });
              }
            } else {
              for (let verse = 1; verse <= maxVerse; verse++) {
                const text = `${verse}`;
                if (!text.startsWith(verseFragment)) continue;
                const value = `${exactBook} ${chapter}:${verse}`;
                push({
                  id: `verse-frag-${exactBook}-${chapter}-${verse}`,
                  label: value,
                  value,
                  helper: 'Verse',
                });
                if (list.length >= 8) break;
              }
            }
          }
        }
      }
    }

    return list.slice(0, 8);
  }, [books, history, query, version]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [query]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (rootRef.current.contains(event.target as Node)) return;
      setShowSuggestions(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const applySuggestion = (value: string) => {
    setQuery(value);
    runSearch(value);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (showSuggestions && suggestions.length > 0 && query.trim()) {
      const selected = suggestions[Math.max(0, Math.min(highlightedIndex, suggestions.length - 1))];
      if (selected) {
        applySuggestion(selected.value);
        return;
      }
    }
    runSearch(query);
  };

  return (
    <form onSubmit={handleSubmit} className="relative w-full max-w-3xl mb-4" ref={rootRef}>
      <div className="relative flex items-center">
        <Search className="absolute left-3 w-5 h-5 text-zinc-500" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onKeyDown={(e) => {
            if (!showSuggestions || suggestions.length === 0) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlightedIndex((prev) => (prev + 1) % suggestions.length);
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlightedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
              return;
            }
            if (e.key === 'Tab') {
              const selected = suggestions[highlightedIndex];
              if (!selected) return;
              e.preventDefault();
              setQuery(selected.value);
            }
            if (e.key === 'Escape') {
              setShowSuggestions(false);
            }
          }}
          placeholder="Enter scripture (e.g. John 3:16)"
          className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl py-3 pl-10 pr-4 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all placeholder:text-zinc-600"
        />
      </div>

      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-20 mt-2 w-full bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden">
          {suggestions.map((s, index) => (
            <button
              key={s.id}
              type="button"
              onClick={() => applySuggestion(s.value)}
              className={`w-full flex items-center justify-between px-3 py-2 text-left text-sm transition-colors ${
                index === highlightedIndex
                  ? 'bg-indigo-500/20 text-white'
                  : 'text-zinc-300 hover:bg-zinc-900'
              }`}
            >
              <span className="truncate">{s.label}</span>
              <span className="text-[10px] text-zinc-500 ml-3 shrink-0">{s.helper}</span>
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
