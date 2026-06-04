/**
 * Share a link via the native share sheet, falling back to copying the URL
 * to the clipboard. Shared by the product page and look overlay so their
 * share affordances behave identically. Returns what happened so the caller
 * can flash a "Copied" confirmation.
 */
export async function shareLink(opts: {
  url: string;
  title?: string;
  text?: string;
}): Promise<'shared' | 'copied' | 'failed'> {
  const { url, title, text } = opts;
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (nav && typeof nav.share === 'function') {
    try {
      await nav.share({ url, title, text });
      return 'shared';
    } catch {
      // User cancelled or the share failed — fall through to clipboard.
    }
  }
  if (nav && nav.clipboard) {
    try {
      await nav.clipboard.writeText(url);
      return 'copied';
    } catch {
      return 'failed';
    }
  }
  return 'failed';
}
