import { useState } from 'react';
import { Link, useSearchParams } from '@remix-run/react';
import CatalogLogo from '~/components/CatalogLogo';

/* /import — Pull an existing storefront into Catalog.
 *
 * Sources are selected via ?source=shopmy|ltk|amazon. Each source
 * gets its own copy and accepted-format hint, but they share the
 * file-drop + URL path. The actual parser/ingest job is wired up
 * once the importer service ships; for now we capture the file
 * and acknowledge so the UI is real end-to-end. */

type Source = 'shopmy' | 'ltk' | 'amazon';

interface SourceMeta {
  id: Source;
  label: string;
  urlPlaceholder: string;
  fileHint: string;
  accept: string;
  intro: string;
}

const SOURCES: Record<Source, SourceMeta> = {
  shopmy: {
    id: 'shopmy',
    label: 'Shop.my',
    urlPlaceholder: 'https://shop.my/yourname',
    fileHint: 'CSV or JSON · up to 25 MB',
    accept: '.csv,.json,application/json,text/csv',
    intro: 'Bring your shop.my storefront over in one click. Drop your export below or paste your storefront URL — we’ll pull every product, image, and link straight in.',
  },
  ltk: {
    id: 'ltk',
    label: 'LTK',
    urlPlaceholder: 'https://www.shopltk.com/explore/yourname',
    fileHint: 'CSV export from LTK Creator · up to 25 MB',
    accept: '.csv,application/csv,text/csv',
    intro: 'Import your LTK storefront. Drop the CSV export from the LTK Creator dashboard or paste your profile URL.',
  },
  amazon: {
    id: 'amazon',
    label: 'Amazon Storefront',
    urlPlaceholder: 'https://www.amazon.com/shop/yourname',
    fileHint: 'CSV export · up to 25 MB',
    accept: '.csv,application/csv,text/csv',
    intro: 'Pull your Amazon Storefront items in. Paste your storefront URL or drop a CSV of your idea-list / collection.',
  },
};

const SOURCE_ORDER: Source[] = ['shopmy', 'ltk', 'amazon'];

export default function ImportRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sourceParam = searchParams.get('source');
  const source = SOURCE_ORDER.includes(sourceParam as Source) ? (sourceParam as Source) : null;

  return (
    <div className="import-page">
      <header className="import-header">
        <Link to="/" className="import-back" aria-label="Back to catalog">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Back to catalog
        </Link>
        <Link to="/" className="import-logo">
          <CatalogLogo />
        </Link>
        <span className="import-header-spacer" aria-hidden />
      </header>

      <main className="import-main">
        {source ? (
          <ImportForSource
            meta={SOURCES[source]}
            onSwitchSource={() => setSearchParams(prev => {
              const p = new URLSearchParams(prev);
              p.delete('source');
              return p;
            })}
          />
        ) : (
          <SourcePicker onPick={(s) => setSearchParams(prev => {
            const p = new URLSearchParams(prev);
            p.set('source', s);
            return p;
          })} />
        )}
      </main>
    </div>
  );
}

function SourcePicker({ onPick }: { onPick: (s: Source) => void }) {
  return (
    <>
      <div className="import-hero">
        <span className="import-eyebrow">Migrate · existing storefront → catalog</span>
        <h1>Import</h1>
        <p>Pick where your storefront lives today and we’ll pull it in.</p>
      </div>
      <div className="import-source-grid">
        {SOURCE_ORDER.map(id => {
          const m = SOURCES[id];
          return (
            <button
              key={id}
              type="button"
              className="import-source-card"
              onClick={() => onPick(id)}
            >
              <span className="import-source-card-label">{m.label}</span>
              <span className="import-source-card-hint">{m.fileHint}</span>
              <svg className="import-source-card-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          );
        })}
      </div>
    </>
  );
}

function ImportForSource({ meta, onSwitchSource }: { meta: SourceMeta; onSwitchSource: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [shopUrl, setShopUrl] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file && !shopUrl) return;
    setSubmitted(true);
  };

  return (
    <>
      <div className="import-hero">
        <button type="button" className="import-eyebrow import-eyebrow-button" onClick={onSwitchSource}>
          ← Migrate · {meta.label} → catalog
        </button>
        <h1>Import your {meta.label}</h1>
        <p>{meta.intro}</p>
      </div>

      {!submitted ? (
        <form className="import-form" onSubmit={submit}>
          <label className="import-field">
            <span className="import-field-label">Storefront URL</span>
            <input
              type="url"
              placeholder={meta.urlPlaceholder}
              value={shopUrl}
              onChange={e => setShopUrl(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
          </label>

          <div className="import-or"><span>or</span></div>

          <label className={`import-drop ${file ? 'has-file' : ''}`}>
            <input
              type="file"
              accept={meta.accept}
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <>
                <strong>{file.name}</strong>
                <span>{Math.round(file.size / 1024).toLocaleString()} KB · click to replace</span>
              </>
            ) : (
              <>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <strong>Drop your {meta.label} export here</strong>
                <span>{meta.fileHint}</span>
              </>
            )}
          </label>

          <button
            type="submit"
            className="import-submit"
            disabled={!file && !shopUrl}
          >
            Start import
          </button>
        </form>
      ) : (
        <div className="import-submitted">
          <div className="import-submitted-icon" aria-hidden>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2>Got it.</h2>
          <p>
            Your import is queued. We’ll email you when it’s done — usually
            under a minute for a few hundred products, longer for full
            storefronts.
          </p>
          <Link to="/" className="import-submit">Back to catalog</Link>
        </div>
      )}

      <ul className="import-faq">
        <li>
          <strong>What gets imported?</strong>
          <span>Products (name, brand, price, image, link), collections, and any tags you’ve set on {meta.label}.</span>
        </li>
        <li>
          <strong>What happens to duplicates?</strong>
          <span>If a product already exists in your catalog we skip it — same brand + name + URL counts as a match.</span>
        </li>
        <li>
          <strong>Will my links still earn?</strong>
          <span>Yes. We preserve your {meta.label} affiliate URLs verbatim, plus rewrite to your catalog tracking on top so you don’t lose attribution.</span>
        </li>
      </ul>
    </>
  );
}
