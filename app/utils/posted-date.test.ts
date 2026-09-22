import { describe, it, expect } from 'vitest';
import { formatPostedDate } from './posted-date';

describe('formatPostedDate', () => {
  it('renders a long-form date', () => {
    const out = formatPostedDate('2026-09-03T12:00:00Z');
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/September|Sept|sept/);
  });
  it('is empty for missing or invalid input', () => {
    expect(formatPostedDate(null)).toBe('');
    expect(formatPostedDate(undefined)).toBe('');
    expect(formatPostedDate('not a date')).toBe('');
  });
});
