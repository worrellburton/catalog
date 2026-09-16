// Step rules for the ShopMy creator import wizard.
//
// Pure — no React, no I/O — so the gating rules are testable on their own,
// the same split as shopmy-ingest-progress.ts.

export type WizardStep = 1 | 2 | 3 | 4 | 5;

export interface WizardSection {
  id: number;
  title: string;
  collections: number;
  pins: number;
}

export interface WizardState {
  step: WizardStep;
  url: string;
  handle: string;
  displayName: string;
  bio: string;
  sections: WizardSection[];
  selectedSections: number[];
}

function isShopMyUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
    return host === 'shopmy.us' || host === 'shop.my';
  } catch {
    return false;
  }
}

/** null when the current step may advance, else the reason to show. */
export function canAdvance(s: WizardState): string | null {
  switch (s.step) {
    case 1:
      if (!s.url.trim()) return 'Paste a ShopMy shop URL.';
      if (!isShopMyUrl(s.url.trim())) return 'That is not a ShopMy URL.';
      return null;
    case 2:
      // Both columns are NOT NULL on creators.
      if (!s.handle.trim()) return 'A handle is required.';
      if (!s.displayName.trim()) return 'A display name is required.';
      return null;
    case 3:
      if (s.selectedSections.length === 0) return 'Select at least one section.';
      return null;
    default:
      return null;
  }
}

export function toggleSection(s: WizardState, id: number): WizardState {
  const on = s.selectedSections.includes(id);
  return {
    ...s,
    selectedSections: on
      ? s.selectedSections.filter((x) => x !== id)
      : [...s.selectedSections, id],
  };
}
