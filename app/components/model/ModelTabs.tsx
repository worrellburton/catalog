import { Link } from '@remix-run/react';

// Switcher between the two financial pages, shown under each title so they
// feel like one tabbed surface.
export default function ModelTabs({ active }: { active: 'model' | 'opex' }) {
  return (
    <div className="model-pageswitch">
      <Link to="/admin/model" className={active === 'model' ? 'is-active' : ''}>Model</Link>
      <Link to="/admin/model/opex" className={active === 'opex' ? 'is-active' : ''}>OpEx</Link>
    </div>
  );
}
