export const normalizeSearchText = (value: unknown) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[\s\-_/\\|,.;:()]+/g, ' ')
    .trim();

export const splitSearchTerms = (keyword: string) =>
  normalizeSearchText(keyword)
    .split(' ')
    .filter(Boolean);

export const matchesScopedSearch = (sourceValues: unknown[], keyword: string) => {
  const terms = splitSearchTerms(keyword);
  if (terms.length === 0) return true;

  const source = normalizeSearchText(sourceValues.filter(Boolean).join(' '));
  return terms.every((term) => source.includes(term));
};
