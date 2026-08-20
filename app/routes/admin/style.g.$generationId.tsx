// Admin · one generation, as its recorded step sequence.
//
// The nodes are NOT derived — generation_events already holds a timestamped log
// written by generate-look and fal-webhook, going back to 2026-05-01. This page
// reads it. Gaps between nodes are log-scaled so a stall is visible before you
// read a number (same idiom as admin/pipeline.product.$id.tsx).

import { useEffect, useState } from 'react';
import { Link, useParams } from '@remix-run/react';
import { getGenerationDetail, listGenerationEvents, type UserGeneration, type UserUpload } from '~/services/user-generations';
import { adminGetGenerationThread } from '~/services/style-up';
import { eventsToNodes, type SpineNode } from '~/services/generation-spine';
import { fmtTime, fmtElapsed, statusClass } from '~/components/style-up/admin-format';
import GenerationDiagram from '~/components/style-up/GenerationDiagram';
import type { AdminLook } from '~/services/style-up';
import '~/styles/admin-style-up.css';

// Real gaps run from ~1s of preprocessing to ~5min of model time. Linear
// spacing would flatten the preprocessing steps into one line, so map log10 of
// the wait onto 12–140px — identical to pipeline.product.$id.tsx's gapPx.
function gapPx(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 12;
  return Math.min(140, Math.max(12, Math.round(14 * Math.log10(1 + seconds))));
}

function gapSeconds(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 1000;
}

function fmtWait(seconds: number): string {
  if (seconds < 1) return 'instant';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function SpineRow({ node, prev }: { node: SpineNode; prev: SpineNode | null }) {
  const [open, setOpen] = useState(false);
  const wait = prev ? gapSeconds(prev.at, node.at) : 0;
  // The one gap worth naming: everything before Fal accepted the job is our own
  // preprocessing; everything after is the model.
  const isModelTime = prev?.event === 'fal_submit_ok' && node.event === 'fal_webhook';
  return (
    <>
      {prev && (
        <li className="gsp-gap" style={{ height: gapPx(wait) }}>
          <span className="gsp-gap-label">{fmtWait(wait)}{isModelTime ? ' · model time' : ''}</span>
        </li>
      )}
      <li className={`gsp-node${node.failed ? ' is-failed' : ''}`}>
        <span className="gsp-dot" aria-hidden="true" />
        <button type="button" className="gsp-card" onClick={() => setOpen(o => !o)}>
          <span className="gsp-label">{node.label}</span>
          <span className="gsp-summary">{node.summary}</span>
          <span className="gsp-at">{fmtTime(node.at)}</span>
        </button>
        {open && <pre className="gsp-payload">{JSON.stringify(node.payload, null, 2)}</pre>}
      </li>
    </>
  );
}

export default function AdminGenerationAudit() {
  const { generationId = '' } = useParams();
  const [gen, setGen] = useState<UserGeneration | null>(null);
  const [uploads, setUploads] = useState<UserUpload[]>([]);
  const [nodes, setNodes] = useState<SpineNode[]>([]);
  const [origin, setOrigin] = useState<{ threadId: string; shopperName: string; stylistName: string | null } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!generationId) return;
    let cancelled = false;
    void (async () => {
      const [detail, events, from] = await Promise.all([
        getGenerationDetail(generationId),
        listGenerationEvents(generationId),
        adminGetGenerationThread(generationId),
      ]);
      if (cancelled) return;
      setGen(detail.generation);
      setUploads(detail.uploads);
      setNodes(eventsToNodes(events));
      setOrigin(from);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [generationId]);

  if (loading) return <div className="sua"><div className="sua-empty">Loading generation…</div></div>;
  if (!gen) return <div className="sua"><div className="sua-empty">That generation no longer exists.</div></div>;

  // GenerationDiagram takes an AdminLook; the audit page has the generation
  // itself, so build the minimum shape it reads.
  const look: AdminLook = {
    messageId: '', threadId: origin?.threadId ?? '', generationId,
    status: gen.status, videoUrl: gen.video_url, createdAt: gen.created_at,
    shopper: { id: gen.user_id, name: origin?.shopperName ?? 'Shopper', avatarUrl: null },
    stylist: null, products: [],
  };

  return (
    <div className="sua">
      <Link to={origin ? `/admin/style/${origin.threadId}` : '/admin/style?tab=generations'} className="suc-back">
        ← {origin ? `${origin.shopperName}${origin.stylistName ? ` with ${origin.stylistName}` : ''}` : 'Generations'}
      </Link>

      <div className="suc-head">
        <div className="suc-head-id">
          <h1 className="sua-title">{gen.display_name || 'Generation'}</h1>
          <p className="sua-sub">
            {gen.veo_model || gen.model} · {gen.duration_seconds}s · started {fmtTime(gen.created_at)}
            {gen.completed_at && ` · took ${fmtElapsed(gen.created_at, gen.completed_at)}`}
          </p>
        </div>
        <span className={statusClass(gen.status)}>{gen.status}</span>
      </div>

      <h2 className="gsp-title">Step sequence</h2>
      {nodes.length === 0 ? (
        <div className="sua-empty">
          No step log — this render predates event capture (2026-05-01).
        </div>
      ) : (
        <ol className="gsp-spine">
          {nodes.map((n, i) => <SpineRow key={n.key} node={n} prev={i > 0 ? nodes[i - 1] : null} />)}
        </ol>
      )}

      <h2 className="gsp-title">Inputs, model, output</h2>
      <GenerationDiagram look={look} gen={gen} uploads={uploads} />
    </div>
  );
}
