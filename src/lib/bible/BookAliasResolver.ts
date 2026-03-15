const aliases: Record<string, string> = {
  'gen': 'Genesis', 'genesis': 'Genesis',
  'exo': 'Exodus', 'exodus': 'Exodus',
  'lev': 'Leviticus', 'leviticus': 'Leviticus',
  'num': 'Numbers', 'numbers': 'Numbers',
  'deut': 'Deuteronomy', 'deuteronomy': 'Deuteronomy',
  'josh': 'Joshua', 'joshua': 'Joshua',
  'judg': 'Judges', 'judges': 'Judges',
  'ruth': 'Ruth',
  '1 sam': '1 Samuel', '1 samuel': '1 Samuel', 'first samuel': '1 Samuel', 'one samuel': '1 Samuel',
  'i samuel': '1 Samuel', '1st samuel': '1 Samuel',
  '2 sam': '2 Samuel', '2 samuel': '2 Samuel', 'second samuel': '2 Samuel', 'two samuel': '2 Samuel',
  'ii samuel': '2 Samuel', '2nd samuel': '2 Samuel',
  '1 kgs': '1 Kings', '1 kings': '1 Kings', 'first kings': '1 Kings', 'one kings': '1 Kings',
  'i kings': '1 Kings', '1st kings': '1 Kings',
  '2 kgs': '2 Kings', '2 kings': '2 Kings', 'second kings': '2 Kings', 'two kings': '2 Kings',
  'ii kings': '2 Kings', '2nd kings': '2 Kings',
  '1 chron': '1 Chronicles', '1 chronicles': '1 Chronicles', 'first chronicles': '1 Chronicles',
  'one chronicles': '1 Chronicles', 'i chronicles': '1 Chronicles', '1st chronicles': '1 Chronicles',
  '2 chron': '2 Chronicles', '2 chronicles': '2 Chronicles', 'second chronicles': '2 Chronicles',
  'two chronicles': '2 Chronicles', 'ii chronicles': '2 Chronicles', '2nd chronicles': '2 Chronicles',
  'ezra': 'Ezra',
  'neh': 'Nehemiah', 'nehemiah': 'Nehemiah',
  'esth': 'Esther', 'esther': 'Esther',
  'job': 'Job',
  'psalm': 'Psalms', 'psalms': 'Psalms', 'psa': 'Psalms',
  'prov': 'Proverbs', 'proverbs': 'Proverbs',
  'eccles': 'Ecclesiastes', 'ecclesiastes': 'Ecclesiastes',
  'song': 'Song of Solomon', 'song of solomon': 'Song of Solomon', 'song of songs': 'Song of Solomon', 'sos': 'Song of Solomon',
  'isa': 'Isaiah', 'isaiah': 'Isaiah',
  'jer': 'Jeremiah', 'jeremiah': 'Jeremiah',
  'lam': 'Lamentations', 'lamentations': 'Lamentations',
  'ezek': 'Ezekiel', 'ezekiel': 'Ezekiel',
  'dan': 'Daniel', 'daniel': 'Daniel',
  'hos': 'Hosea', 'hosea': 'Hosea',
  'joel': 'Joel',
  'amos': 'Amos',
  'obad': 'Obadiah', 'obadiah': 'Obadiah',
  'jonah': 'Jonah',
  'micah': 'Micah',
  'nahum': 'Nahum',
  'hab': 'Habakkuk', 'habakkuk': 'Habakkuk',
  'zeph': 'Zephaniah', 'zephaniah': 'Zephaniah',
  'hag': 'Haggai', 'haggai': 'Haggai',
  'zech': 'Zechariah', 'zechariah': 'Zechariah',
  'mal': 'Malachi', 'malachi': 'Malachi',
  'matt': 'Matthew', 'matthew': 'Matthew',
  'mark': 'Mark',
  'luke': 'Luke',
  'jn': 'John', 'joh': 'John', 'john': 'John',
  'acts': 'Acts',
  'rom': 'Romans', 'romans': 'Romans',
  '1 cor': '1 Corinthians', '1 corinthians': '1 Corinthians', 'first corinthians': '1 Corinthians', 'one corinthians': '1 Corinthians',
  'i corinthians': '1 Corinthians', 'i cor': '1 Corinthians', '1st corinthians': '1 Corinthians',
  '2 cor': '2 Corinthians', '2 corinthians': '2 Corinthians', 'second corinthians': '2 Corinthians', 'two corinthians': '2 Corinthians',
  'ii corinthians': '2 Corinthians', 'ii cor': '2 Corinthians', '2nd corinthians': '2 Corinthians',
  'gal': 'Galatians', 'galatians': 'Galatians',
  'eph': 'Ephesians', 'ephesians': 'Ephesians',
  'phil': 'Philippians', 'philippians': 'Philippians',
  'col': 'Colossians', 'colossians': 'Colossians',
  '1 thess': '1 Thessalonians', '1 thessalonians': '1 Thessalonians', 'first thessalonians': '1 Thessalonians',
  'i thessalonians': '1 Thessalonians', 'i thess': '1 Thessalonians', '1st thessalonians': '1 Thessalonians',
  '2 thess': '2 Thessalonians', '2 thessalonians': '2 Thessalonians', 'second thessalonians': '2 Thessalonians',
  'ii thessalonians': '2 Thessalonians', 'ii thess': '2 Thessalonians', '2nd thessalonians': '2 Thessalonians',
  '1 tim': '1 Timothy', '1 timothy': '1 Timothy', 'first timothy': '1 Timothy',
  'i timothy': '1 Timothy', 'i tim': '1 Timothy', '1st timothy': '1 Timothy',
  '2 tim': '2 Timothy', '2 timothy': '2 Timothy', 'second timothy': '2 Timothy',
  'ii timothy': '2 Timothy', 'ii tim': '2 Timothy', '2nd timothy': '2 Timothy',
  'titus': 'Titus',
  'philem': 'Philemon', 'philemon': 'Philemon',
  'heb': 'Hebrews', 'hebrews': 'Hebrews',
  'jas': 'James', 'james': 'James',
  '1 pet': '1 Peter', '1 peter': '1 Peter', 'first peter': '1 Peter',
  'i peter': '1 Peter', 'i pet': '1 Peter', '1st peter': '1 Peter',
  '2 pet': '2 Peter', '2 peter': '2 Peter', 'second peter': '2 Peter',
  'ii peter': '2 Peter', 'ii pet': '2 Peter', '2nd peter': '2 Peter',
  '1 john': '1 John', 'first john': '1 John', 'one john': '1 John',
  'i john': '1 John', '1st john': '1 John',
  '2 john': '2 John', 'second john': '2 John', 'two john': '2 John',
  'ii john': '2 John', '2nd john': '2 John',
  '3 john': '3 John', 'third john': '3 John', 'three john': '3 John',
  'iii john': '3 John', '3rd john': '3 John',
  'jude': 'Jude',
  'rev': 'Revelation', 'revelation': 'Revelation'
};

export class BookAliasResolver {
  public static resolve(input: string): string | null {
    const lower = input.toLowerCase().trim();
    return aliases[lower] || null;
  }
  
  public static extractBook(text: string): { book: string, remaining: string } | null {
    const words = text.split(/\s+/);
    
    // Check up to 3 words (e.g., "1 John", "Song of Solomon")
    for (let i = Math.min(3, words.length); i > 0; i--) {
      const possibleBook = words.slice(0, i).join(' ');
      const resolved = this.resolve(possibleBook);
      if (resolved) {
        return {
          book: resolved,
          remaining: words.slice(i).join(' ')
        };
      }
    }
    
    // Also try to find a book anywhere in the text
    for (let start = 0; start < words.length; start++) {
      for (let i = Math.min(3, words.length - start); i > 0; i--) {
        const possibleBook = words.slice(start, start + i).join(' ');
        const resolved = this.resolve(possibleBook);
        if (resolved) {
          return {
            book: resolved,
            remaining: words.slice(start + i).join(' ')
          };
        }
      }
    }
    
    return null;
  }
}
