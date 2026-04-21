export const CUSTOMER_TEXT_SEPARATOR = /[\n,;，、]+/;

export const splitCustomerTextList = (value?: string[] | string | null) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map(item => String(item).trim()).filter(Boolean)));
  }

  if (typeof value === 'string') {
    return Array.from(new Set(
      value
        .split(CUSTOMER_TEXT_SEPARATOR)
        .map(item => item.trim())
        .filter(Boolean),
    ));
  }

  return [];
};
