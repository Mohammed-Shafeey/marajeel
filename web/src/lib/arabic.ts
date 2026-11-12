/**
 * Arabic-aware search: strips diacritics and tatweel, unifies alef/hamza forms, taa marbuta and
 * alef maqsura, so "احمد" finds "أحمد" and "عبدالله" finds "عبد الله".
 */
export function normalizeArabic(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[ً-ٰٟۖ-ۭ]/g, '') // tashkeel & Quranic marks
    .replace(/ـ/g, '') // tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, '')
    .toLowerCase();
}

export const matchesSearch = (name: string, query: string) =>
  !query.trim() || normalizeArabic(name).includes(normalizeArabic(query));

const collator = new Intl.Collator(['ar', 'en'], { sensitivity: 'base', ignorePunctuation: true });
export const compareNames = (a: string, b: string) => collator.compare(a, b);

/** Two-letter initials: first letter of first and last word. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = [...parts[0]][0] ?? '';
  const lastWord = parts.length > 1 ? parts[parts.length - 1].replace(/^ال/, '') : '';
  const last = lastWord ? [...lastWord][0] : '';
  return `${first}${last ? ' ' + last : ''}`;
}

/** Card name: explicit short name, else the family name (≤ 12 chars), else the first name. */
export function cardName(name: string, shortName?: string | null): string {
  if (shortName?.trim()) return shortName.trim();
  const parts = name.trim().split(/\s+/);
  const family = parts.length > 1 ? parts[parts.length - 1] : parts[0];
  return family.length <= 12 ? family : parts[0];
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
