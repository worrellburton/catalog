import { describe, it, expect } from 'vitest';
import { canAdvance, toggleSection, type WizardState } from './shopmy-wizard-state';

const base: WizardState = {
  step: 1,
  url: 'https://shopmy.us/shop/justbobbidotcom',
  handle: 'justbobbidotcom',
  displayName: 'Bobbi Brown',
  bio: '',
  sections: [
    { id: 409, title: "Bobbi's Closet", collections: 14, pins: 123 },
    { id: 2387365, title: 'Dogs', collections: 3, pins: 9 },
  ],
  selectedSections: [409, 2387365],
};

describe('canAdvance', () => {
  it('blocks step 1 without a ShopMy URL', () => {
    expect(canAdvance({ ...base, step: 1, url: '' })).toMatch(/url/i);
    expect(canAdvance({ ...base, step: 1, url: 'https://ltk.app/someone' })).toMatch(/shopmy/i);
    expect(canAdvance({ ...base, step: 1 })).toBeNull();
  });

  it('blocks step 2 without a handle or a display name', () => {
    // creators.handle and creators.display_name are both NOT NULL.
    expect(canAdvance({ ...base, step: 2, handle: '' })).toMatch(/handle/i);
    expect(canAdvance({ ...base, step: 2, displayName: '  ' })).toMatch(/name/i);
    expect(canAdvance({ ...base, step: 2 })).toBeNull();
  });

  it('blocks step 3 with zero sections selected', () => {
    // Without this the run would list every section and quietly import the
    // non-apparel ones the operator just unticked.
    expect(canAdvance({ ...base, step: 3, selectedSections: [] })).toMatch(/section/i);
    expect(canAdvance({ ...base, step: 3 })).toBeNull();
  });

  it('does not gate the preview and import steps', () => {
    expect(canAdvance({ ...base, step: 4 })).toBeNull();
    expect(canAdvance({ ...base, step: 5 })).toBeNull();
  });
});

describe('toggleSection', () => {
  it('removes a selected section and adds an unselected one', () => {
    const off = toggleSection(base, 409);
    expect(off.selectedSections).toEqual([2387365]);
    expect(toggleSection(off, 409).selectedSections.sort((a, b) => a - b)).toEqual([409, 2387365]);
  });

  it('does not mutate the input state', () => {
    const before = [...base.selectedSections];
    toggleSection(base, 409);
    expect(base.selectedSections).toEqual(before);
  });
});
