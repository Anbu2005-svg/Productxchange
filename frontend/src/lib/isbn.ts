/**
 * Client-Side ISBN & Book Metadata Lookup Utility for ProductXchange
 *
 * 100% client-side, zero server load.
 * Queries OpenLibrary API (and Google Books fallback) to fetch title, author,
 * publisher, publish date, and book cover from 10 or 13-digit ISBN barcodes.
 */

export interface BookMetadata {
  isbn: string;
  title: string;
  authors: string[];
  publisher?: string;
  publishYear?: string;
  pages?: number;
  coverUrl?: string;
  description?: string;
  suggestedCategory: string;
}

/**
 * Normalizes an ISBN string by stripping hyphens and spaces.
 */
export function normalizeIsbn(raw: string): string {
  return raw.replace(/[^0-9X]/gi, "").toUpperCase();
}

/**
 * Validates whether a string is a syntactically valid ISBN-10 or ISBN-13.
 */
export function isValidIsbn(isbn: string): boolean {
  const cleaned = normalizeIsbn(isbn);
  if (cleaned.length === 10) {
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      const digit = parseInt(cleaned[i], 10);
      if (isNaN(digit)) return false;
      sum += (10 - i) * digit;
    }
    const lastChar = cleaned[9];
    const check = lastChar === "X" ? 10 : parseInt(lastChar, 10);
    if (isNaN(check)) return false;
    sum += check;
    return sum % 11 === 0;
  }

  if (cleaned.length === 13) {
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      const digit = parseInt(cleaned[i], 10);
      if (isNaN(digit)) return false;
      sum += i % 2 === 0 ? digit : digit * 3;
    }
    const check = parseInt(cleaned[12], 10);
    if (isNaN(check)) return false;
    const remainder = sum % 10;
    const expected = remainder === 0 ? 0 : 10 - remainder;
    return check === expected;
  }

  return false;
}

/**
 * Fetches book metadata from OpenLibrary (with Google Books API fallback).
 */
export async function lookupIsbn(rawIsbn: string): Promise<BookMetadata> {
  const isbn = normalizeIsbn(rawIsbn);
  if (!isbn || (isbn.length !== 10 && isbn.length !== 13)) {
    throw new Error("Please enter a valid 10 or 13-digit ISBN");
  }

  // 1. Try OpenLibrary Data API
  try {
    const olUrl = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`;
    const res = await fetch(olUrl, { cache: "force-cache" });
    if (res.ok) {
      const data = await res.json();
      const book = data[`ISBN:${isbn}`];
      if (book && book.title) {
        const authors = (book.authors || []).map((a: { name: string }) => a.name);
        const publisher = book.publishers?.[0]?.name;
        const publishYear = book.publish_date;
        const pages = book.number_of_pages;
        const coverUrl = book.cover?.large || book.cover?.medium || book.cover?.small;

        const descParts: string[] = [];
        if (authors.length > 0) descParts.push(`Author: ${authors.join(", ")}`);
        if (publisher) descParts.push(`Publisher: ${publisher}`);
        if (publishYear) descParts.push(`Published: ${publishYear}`);
        if (pages) descParts.push(`Pages: ${pages}`);
        descParts.push(`ISBN: ${isbn}`);

        return {
          isbn,
          title: book.title + (book.subtitle ? `: ${book.subtitle}` : ""),
          authors,
          publisher,
          publishYear,
          pages,
          coverUrl,
          description: descParts.join(" • "),
          suggestedCategory: "Textbooks & Study Material",
        };
      }
    }
  } catch (err) {
    console.warn("OpenLibrary lookup failed, attempting fallback...", err);
  }

  // 2. Fallback to Google Books Volumes API
  try {
    const gbUrl = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`;
    const res = await fetch(gbUrl);
    if (res.ok) {
      const data = await res.json();
      if (data.totalItems > 0 && data.items?.[0]?.volumeInfo) {
        const info = data.items[0].volumeInfo;
        const authors = info.authors || [];
        const publisher = info.publisher;
        const publishYear = info.publishedDate;
        const pages = info.pageCount;
        const coverUrl = info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail;

        const descParts: string[] = [];
        if (authors.length > 0) descParts.push(`Author: ${authors.join(", ")}`);
        if (publisher) descParts.push(`Publisher: ${publisher}`);
        if (publishYear) descParts.push(`Published: ${publishYear}`);
        if (pages) descParts.push(`Pages: ${pages}`);
        descParts.push(`ISBN: ${isbn}`);
        if (info.description) {
          descParts.push(`\nSummary: ${info.description.slice(0, 280)}...`);
        }

        return {
          isbn,
          title: info.title + (info.subtitle ? `: ${info.subtitle}` : ""),
          authors,
          publisher,
          publishYear,
          pages,
          coverUrl,
          description: descParts.join(" • "),
          suggestedCategory: "Textbooks & Study Material",
        };
      }
    }
  } catch (err) {
    console.warn("Google Books fallback failed", err);
  }

  throw new Error(`No book metadata found for ISBN ${isbn}. You can still fill details manually.`);
}
