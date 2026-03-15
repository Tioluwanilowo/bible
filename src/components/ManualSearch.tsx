import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { useStore } from '../store/useStore';
import { parseReference, getScripture } from '../lib/bibleEngine';

export default function ManualSearch() {
  const [query, setQuery] = useState('');
  const { version, setPreview, logActivity } = useStore();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    const parsed = parseReference(query);
    if (parsed) {
      const scripture = getScripture(parsed.book, parsed.chapter, parsed.verse, version, parsed.endVerse);
      if (scripture) {
        setPreview(scripture);
        logActivity(`Manual lookup: ${scripture.book} ${scripture.chapter}:${scripture.verse}${scripture.endVerse ? `-${scripture.endVerse}` : ''}`);
        setQuery('');
      } else {
        logActivity(`Verse not found in sample data: ${parsed.book} ${parsed.chapter}:${parsed.verse}${parsed.endVerse ? `-${parsed.endVerse}` : ''}`);
      }
    } else {
      logActivity(`Invalid reference format: ${query}`);
    }
  };

  return (
    <form onSubmit={handleSearch} className="relative w-full max-w-md mb-6">
      <div className="relative flex items-center">
        <Search className="absolute left-3 w-5 h-5 text-zinc-500" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Enter scripture (e.g. John 3:16)"
          className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl py-3 pl-10 pr-4 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all placeholder:text-zinc-600"
        />
      </div>
    </form>
  );
}
