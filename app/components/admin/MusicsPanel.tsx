// MusicsPanel — admin Data → Musics tab. Spotify search + add, list, delete the
// catalog's music tracks. Extracted from app/routes/admin/data.tsx (god-file
// split #8); owns its own state, talks only to the musics service.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  spotifySearch,
  listMusics,
  addMusicFromSpotify,
  deleteMusic,
  formatTrackDuration,
  type MusicTrack,
  type SpotifySearchHit,
} from '~/services/musics';
import { catalogConfirm } from '~/components/CatalogDialog';

export function MusicsPanel() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SpotifySearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [library, setLibrary] = useState<MusicTrack[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [busyTrackId, setBusyTrackId] = useState<string | null>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLibraryLoading(true);
    listMusics()
      .then(rows => { if (!cancelled) setLibrary(rows); })
      .catch(() => { /* surfaced in the empty state */ })
      .finally(() => { if (!cancelled) setLibraryLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Debounced Spotify search. Re-runs 350ms after the last keystroke so
  // typing "frank ocean" doesn't fire seven separate requests.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults([]); setSearchError(null); return; }
    setSearching(true);
    const t = window.setTimeout(() => {
      spotifySearch(q, 16)
        .then(hits => { setResults(hits); setSearchError(null); })
        .catch(err => { setResults([]); setSearchError(err instanceof Error ? err.message : String(err)); })
        .finally(() => setSearching(false));
    }, 350);
    return () => window.clearTimeout(t);
  }, [query]);

  const savedIds = useMemo(() => new Set(library.map(m => m.spotify_track_id)), [library]);

  const handleAdd = async (hit: SpotifySearchHit) => {
    setBusyTrackId(hit.id);
    try {
      const row = await addMusicFromSpotify(hit);
      setLibrary(prev => [row, ...prev.filter(m => m.id !== row.id)]);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Failed to save track');
    } finally {
      setBusyTrackId(null);
    }
  };

  const handleDelete = async (track: MusicTrack) => {
    if (!(await catalogConfirm({ title: `Remove "${track.name}" from the library?`, danger: true, confirmLabel: 'Remove' }))) return;
    setBusyTrackId(track.id);
    try {
      await deleteMusic(track.id);
      setLibrary(prev => prev.filter(m => m.id !== track.id));
    } finally {
      setBusyTrackId(null);
    }
  };

  // Single-audio playback — start a preview, stop the previous one.
  const togglePreview = (id: string, url: string | null) => {
    if (!url) return;
    if (playingId === id) {
      previewRef.current?.pause();
      setPlayingId(null);
      return;
    }
    if (previewRef.current) {
      previewRef.current.pause();
    } else {
      previewRef.current = new Audio(url);
    }
    previewRef.current.src = url;
    previewRef.current.onended = () => setPlayingId(null);
    void previewRef.current.play();
    setPlayingId(id);
  };

  return (
    <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Music library</h2>
        <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
          Search Spotify and save tracks to the platform’s shared music catalog.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          type="search"
          inputMode="search"
          placeholder="Search Spotify — song, artist, album…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoFocus
          style={{
            width: '100%', maxWidth: 480, padding: '10px 14px',
            fontSize: 14, borderRadius: 10, border: '1px solid #e2e8f0',
            background: '#fff', outline: 'none',
          }}
        />
        {searchError && (
          <div style={{ fontSize: 12, color: '#b91c1c', maxWidth: 720 }}>
            {searchError}
            {searchError.includes('SPOTIFY_CLIENT_ID') && (
              <span style={{ display: 'block', marginTop: 4, color: '#64748b' }}>
                Set <code>SPOTIFY_CLIENT_ID</code> and <code>SPOTIFY_CLIENT_SECRET</code> under
                Supabase → Functions → Secrets, then try again.
              </span>
            )}
          </div>
        )}
      </div>

      {query.trim() && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {searching ? 'Searching…' : `${results.length} result${results.length === 1 ? '' : 's'}`}
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {results.map(hit => {
              const saved = savedIds.has(hit.id);
              const playing = playingId === hit.id;
              return (
                <div key={hit.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 12px', borderRadius: 10,
                  border: '1px solid #f1f5f9', background: '#fff',
                }}>
                  {hit.thumbnail_url
                    ? <img src={hit.thumbnail_url} alt="" style={{ width: 48, height: 48, borderRadius: 6, objectFit: 'cover' }} />
                    : <div style={{ width: 48, height: 48, borderRadius: 6, background: '#f1f5f9' }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {hit.name}
                      {hit.explicit && (
                        <span style={{ marginLeft: 6, padding: '0 5px', borderRadius: 3, background: '#0f172a', color: '#fff', fontSize: 9, fontWeight: 700, letterSpacing: '0.04em' }}>E</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {hit.artists}{hit.album ? ` · ${hit.album}` : ''} · {formatTrackDuration(hit.duration_ms)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => togglePreview(hit.id, hit.preview_url)}
                    disabled={!hit.preview_url}
                    title={hit.preview_url ? (playing ? 'Pause preview' : 'Play 30s preview') : 'No preview available'}
                    style={{
                      width: 32, height: 32, borderRadius: '50%',
                      border: '1px solid #e2e8f0', background: '#fff',
                      cursor: hit.preview_url ? 'pointer' : 'not-allowed',
                      color: hit.preview_url ? '#0f172a' : '#cbd5e1',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {playing
                      ? <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>
                      : <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAdd(hit)}
                    disabled={saved || busyTrackId === hit.id}
                    className="admin-btn admin-btn-primary"
                    style={{ fontSize: 12, padding: '6px 12px' }}
                  >
                    {saved ? 'Added' : busyTrackId === hit.id ? 'Adding…' : 'Add'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Library · {library.length} track{library.length === 1 ? '' : 's'}
        </div>
        {libraryLoading ? (
          <div className="admin-empty">Loading…</div>
        ) : library.length === 0 ? (
          <div className="admin-empty">Nothing saved yet. Search above to add tracks.</div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 56 }}></th>
                <th style={{ textAlign: 'left' }}>Track</th>
                <th style={{ textAlign: 'left' }}>Artist</th>
                <th style={{ textAlign: 'left' }}>Album</th>
                <th>Length</th>
                <th></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {library.map(t => {
                const playing = playingId === t.spotify_track_id;
                return (
                  <tr key={t.id}>
                    <td>
                      {t.thumbnail_url
                        ? <img src={t.thumbnail_url} alt="" style={{ width: 40, height: 40, borderRadius: 4, objectFit: 'cover' }} />
                        : <div style={{ width: 40, height: 40, borderRadius: 4, background: '#f1f5f9' }} />}
                    </td>
                    <td style={{ fontWeight: 600 }}>
                      {t.name}
                      {t.explicit && (
                        <span style={{ marginLeft: 6, padding: '0 5px', borderRadius: 3, background: '#0f172a', color: '#fff', fontSize: 9, fontWeight: 700 }}>E</span>
                      )}
                    </td>
                    <td style={{ color: '#475569' }}>{t.artist || '—'}</td>
                    <td style={{ color: '#475569' }}>{t.album || '—'}</td>
                    <td style={{ textAlign: 'center', color: '#475569', fontVariantNumeric: 'tabular-nums' }}>
                      {formatTrackDuration(t.duration_ms)}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => togglePreview(t.spotify_track_id, t.preview_url)}
                        disabled={!t.preview_url}
                        title={t.preview_url ? (playing ? 'Pause' : 'Play preview') : 'No preview'}
                        style={{
                          width: 28, height: 28, borderRadius: '50%',
                          border: '1px solid #e2e8f0', background: '#fff',
                          cursor: t.preview_url ? 'pointer' : 'not-allowed',
                          color: t.preview_url ? '#0f172a' : '#cbd5e1',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        {playing
                          ? <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>
                          : <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>}
                      </button>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {t.external_url && (
                        <a href={t.external_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#1d4ed8', marginRight: 12 }}>
                          Spotify ↗
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDelete(t)}
                        disabled={busyTrackId === t.id}
                        style={{ fontSize: 11, color: '#b91c1c', background: 'transparent', border: 'none', cursor: 'pointer' }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
