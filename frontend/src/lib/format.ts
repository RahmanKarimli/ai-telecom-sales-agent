export const money = (minor: number) => `${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AZN`;
export const moneyShort = (minor: number) => `${(minor / 100).toFixed(2)}`;
export const prettyMonth = (value: string, locale = 'en-US') => new Date(`${value.slice(0, 7)}-01T12:00:00`).toLocaleDateString(locale, { month: 'short' });
export const prettyDateTime = (value: string, locale = 'en-US') => new Date(value).toLocaleString(locale, { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
export const pct = (value: number) => `${Math.round(value)}%`;
export const initials = (name: string) => name.split(/\s+/).slice(0, 2).map(x => x.charAt(0)).join('').toUpperCase();
export const idempotencyKey = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
