// ModelDetailsPanel — the expandable pipeline-detail row for an unpublished
// look on the admin Data → Looks tab. Presentational; reads the look's gen
// fields. Extracted from app/routes/admin/data.tsx (god-file split #8).

import type { UnpublishedLook } from '~/types/admin-data';

export function ModelDetailsPanel({ gen }: { gen: UnpublishedLook }) {
  const modelLabel = gen.model
    ? gen.model === 'pro' ? 'Pro (Seedance Pro)' : 'Fast (Seedance Lite)'
    : ' - ';
  const modelTier = gen.veo_model || (gen.model === 'pro' ? 'bytedance/seedance/v1/pro' : gen.model === 'fast' ? 'bytedance/seedance/v1/lite' : null);

  type NodeStatus = 'done' | 'active' | 'pending' | 'failed';
  const status = gen.status;
  const statusOf = (i: number): NodeStatus => {
    // 0 photo, 1 products, 2 prompt, 3 model call, 4 video, 5 status
    if (status === 'failed') {
      // Mark the call (index 3) as failed; everything before it is done,
      // everything after stays pending so the failure point is obvious.
      if (i < 3) return 'done';
      if (i === 3) return 'failed';
      return 'pending';
    }
    if (status === 'done') return 'done';
    // pending / generating: photo + products + prompt are done by the time
    // the row exists; the call is in flight, video + status are pending.
    if (i <= 2) return 'done';
    if (i === 3) return 'active';
    return 'pending';
  };

  const nodes = [
    {
      label: 'Face photo',
      sub: 'user_uploads',
      detail: 'Reference photo uploaded via /generate',
    },
    {
      label: 'Products',
      sub: `${gen.product_count} item${gen.product_count === 1 ? '' : 's'}`,
      detail: 'user_generation_products - role-tagged for prompt slotting',
    },
    {
      label: 'Prompt',
      sub: gen.style,
      detail: gen.prompt ? `${gen.prompt.length} chars` : 'Assembled from style preset + role tags',
    },
    {
      label: 'Model call',
      sub: modelLabel,
      detail: gen.fal_request_id ? `fal_id ${gen.fal_request_id.slice(0, 10)}…` : 'Fal queue submission',
    },
    {
      label: 'Video',
      sub: gen.video_url ? 'Stored' : 'Pending',
      detail: gen.storage_path || (gen.video_url ? 'Hosted on Fal CDN' : ' - '),
    },
    {
      label: 'Status',
      sub: status,
      detail: gen.completed_at ? new Date(gen.completed_at).toLocaleString() : ' - ',
    },
  ];

  return (
    <div className="admin-model-panel">
      <div className="admin-model-panel-head">
        <h3 className="admin-products-title" style={{ margin: 0 }}>Pipeline</h3>
        <span className="admin-model-panel-meta">
          gen <code>{gen.id.slice(0, 8)}…</code> · created {new Date(gen.created_at).toLocaleString()}
        </span>
      </div>

      <div className="admin-model-flow">
        {nodes.map((n, i) => (
          <div key={n.label} className="admin-model-flow-step">
            <div className={`admin-model-node admin-model-node--${statusOf(i)}`}>
              <div className="admin-model-node-num">{i + 1}</div>
              <div className="admin-model-node-body">
                <div className="admin-model-node-label">{n.label}</div>
                <div className="admin-model-node-sub">{n.sub}</div>
                <div className="admin-model-node-detail">{n.detail}</div>
              </div>
            </div>
            {i < nodes.length - 1 && (
              <svg className="admin-model-arrow" width="22" height="14" viewBox="0 0 22 14" fill="none">
                <path d="M1 7H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M14 1L20 7L14 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        ))}
      </div>

      <div className="admin-model-grid">
        <div className="admin-model-card">
          <div className="admin-model-card-label">Model</div>
          <div className="admin-model-card-value">{modelLabel}</div>
          {modelTier && <div className="admin-model-card-sub">{modelTier}</div>}
        </div>
        <div className="admin-model-card">
          <div className="admin-model-card-label">Style preset</div>
          <div className="admin-model-card-value" style={{ textTransform: 'capitalize' }}>{gen.style}</div>
        </div>
        <div className="admin-model-card">
          <div className="admin-model-card-label">Height</div>
          <div className="admin-model-card-value">
            {gen.height_label || (gen.height_cm ? `${gen.height_cm} cm` : ' - ')}
          </div>
        </div>
        <div className="admin-model-card">
          <div className="admin-model-card-label">Age band</div>
          <div className="admin-model-card-value">{gen.age_label || ' - '}</div>
        </div>
        <div className="admin-model-card">
          <div className="admin-model-card-label">Fal request id</div>
          <div className="admin-model-card-value admin-model-mono">
            {gen.fal_request_id || ' - '}
          </div>
        </div>
        <div className="admin-model-card">
          <div className="admin-model-card-label">Completed at</div>
          <div className="admin-model-card-value">
            {gen.completed_at ? new Date(gen.completed_at).toLocaleString() : ' - '}
          </div>
        </div>
      </div>

      <div className="admin-model-prompt">
        <div className="admin-model-card-label">Prompt sent to {modelLabel}</div>
        <pre className="admin-model-prompt-body">
          {gen.prompt || ' -  no prompt recorded  - '}
        </pre>
      </div>

      {gen.video_url && (
        <div className="admin-model-output">
          <div className="admin-model-card-label">Output</div>
          <a
            href={gen.video_url}
            target="_blank"
            rel="noopener noreferrer"
            className="admin-model-mono admin-model-link"
          >
            {gen.video_url}
          </a>
          {gen.storage_path && (
            <div className="admin-model-card-sub admin-model-mono">{gen.storage_path}</div>
          )}
        </div>
      )}

      {gen.error && (
        <div className="admin-model-error">
          <div className="admin-model-card-label">Error</div>
          <pre className="admin-model-prompt-body admin-model-error-body">{gen.error}</pre>
        </div>
      )}
    </div>
  );
}
