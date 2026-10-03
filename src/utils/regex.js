/** Escapes user text for use inside a RegExp (admin search boxes). */
export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
