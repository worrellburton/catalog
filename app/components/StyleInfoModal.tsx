// StyleInfoModal — "How styling works": the full tech + flow behind the Style Up
// styling system (the simulation cockpit + the chat→demand loop). Mirrors the
// "How seeding works" modal on /admin/seeding. Pure presentational.

export default function StyleInfoModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal admin-modal-wide" onClick={e => e.stopPropagation()} style={{ maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div className="admin-modal-header">
          <h3>How styling works</h3>
          <button className="admin-modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="admin-modal-body" style={{ overflow: 'auto', fontSize: 14, lineHeight: 1.55 }}>
          <p style={{ marginTop: 0 }}>
            <strong>Style Up</strong> is the AI-stylist experience: a shopper chats a stylist persona,
            gets product picks, and can render the look on themselves. The hard part isn’t taste —
            a strong model already knows fashion — it’s <strong>showing the stylist the right products</strong>.
            So styling is a <strong>retrieval</strong> problem, solved by two loops:
          </p>
          <ul style={{ marginTop: 0 }}>
            <li><strong>Simulation cockpit</strong> — generate styling scenarios, run the engine on them, see the outfit + gaps. Prove accuracy before it ships.</li>
            <li><strong>Chat → demand</strong> — what shoppers ask stylists for, that we don’t have, becomes catalog demand. The catalog grows itself.</li>
          </ul>

          <h4 style={{ marginBottom: 6 }}>Loop A — follow one scenario (the cockpit)</h4>
          <ol style={{ marginTop: 0, paddingLeft: 18 }}>
            <li><strong>Generate</strong> — Claude (<code>generate-style-scenarios</code>) brainstorms diverse scenarios (occasion × gender × season), e.g. <em>“evening at a night club · male · formality 3 · tops/bottoms/shoes/jackets”</em>, stored as <code>seed_targets(kind=&#39;scenario&#39;)</code> with structured <code>intent</code>, <strong>paused</strong>.</li>
            <li><strong>Simulate</strong> — pick a <strong>stylist persona</strong> + a <strong>user</strong>, run <code>style-engine</code> over the live catalog.</li>
            <li><strong>Retrieve per slot</strong> — for each garment (top, bottom, shoes…) the engine calls <code>style_slot_search</code> → <code>search_products</code>, which ranks the catalog by <strong>occasion text + the stylist’s aesthetic</strong> (BM25 / <code>ts_rank_cd</code>), gender-filtered — so different stylists shop different pools (Devon pulls sneakers, Margot pulls tailored). Not a random recent slice; the same ranker consumer search uses.</li>
            <li><strong>Assemble</strong> — Claude builds up to <strong>3 distinct looks</strong> to choose from, each a coherent outfit from <em>only</em> those real candidates, in the stylist’s voice, validating gender + grounding (never a product we don’t have).</li>
            <li><strong>See results + gaps</strong> — each look shows per slot; a slot the catalog can’t fill at all is a <strong>gap</strong>.</li>
            <li><strong>Seed the gap</strong> — one click turns a gap into an <code>approved</code> demand target (in the <strong>Searches</strong> tab). The seeding loop fetches it, and the next simulation is better.</li>
          </ol>

          <h4 style={{ marginBottom: 6 }}>Loop B — follow one chat (auto-fill what’s missing)</h4>
          <ol style={{ marginTop: 0, paddingLeft: 18 }}>
            <li>A shopper chats a stylist (<em>“something for a rooftop techno rave”</em>). Each turn records a <code>style_up_traces</code> row — the occasion + the garments the stylist was reaching for.</li>
            <li>Every 30 min, <code>refresh_seed_targets_from_style_chats()</code> reads new traces and pulls the styling terms (web stylists’ garment queries + the shopper’s message).</li>
            <li><strong>Coverage gate</strong> — it keeps only terms the catalog <em>doesn’t</em> cover (no active product matches the whole need), and queues them as <strong>pending</strong> demand.</li>
            <li>The existing seeding pipeline takes over: <code>seed-curate</code> (Claude) vets → <code>seed-run</code> fetches → activation publishes. <strong>What a stylist couldn’t find becomes a real product.</strong></li>
          </ol>

          <h4 style={{ marginBottom: 6 }}>Under the hood</h4>
          <table className="admin-table" style={{ marginBottom: 8 }}>
            <thead><tr><th>Piece</th><th>Component</th><th>Tech</th></tr></thead>
            <tbody>
              <tr><td>Generate scenarios</td><td><code>generate-style-scenarios</code></td><td>Claude Sonnet → scenario rows + intent</td></tr>
              <tr><td>Per-slot retrieval</td><td><code>style_slot_search</code> → <code>search_products</code></td><td>BM25 / <code>ts_rank_cd</code> over name + occasion text, gender filter</td></tr>
              <tr><td>Assemble outfit</td><td><code>style-engine</code> (standalone)</td><td>Claude Opus + gender/grounding validation</td></tr>
              <tr><td>Simulate UI</td><td><code>StyleSimulateModal</code></td><td>stylist + user pickers, renders outfit/gaps</td></tr>
              <tr><td>Chat → demand</td><td><code>refresh_seed_targets_from_style_chats()</code></td><td>SQL over <code>style_up_traces</code> + AND coverage gate</td></tr>
              <tr><td>Fill the demand</td><td><code>seed-curate</code> · <code>seed-run</code> · activation</td><td>the seeding pipeline (reused, not rebuilt)</td></tr>
            </tbody>
          </table>
          <p className="admin-cell-muted" style={{ marginTop: 0 }}>
            The simulation <code>style-engine</code> is <strong>separate from the live stylist chat</strong>
            (<code>style-up-chat</code>, untouched) — it’s the cockpit to prove the engine before connecting it.
          </p>

          <h4 style={{ marginBottom: 6 }}>Automation (pg_cron)</h4>
          <table className="admin-table" style={{ marginBottom: 12 }}>
            <thead><tr><th>Job</th><th>Calls</th><th>Runs</th><th>Spends $?</th></tr></thead>
            <tbody>
              <tr><td>Generate styling scenarios</td><td><code>generate-style-scenarios</code></td><td>weekly (Mon)</td><td>no (Claude only)</td></tr>
              <tr><td>Pull stylist-chat demand</td><td><code>refresh…_style_chats()</code></td><td>30 min</td><td>no (queue only)</td></tr>
              <tr><td>…then fetch / enrich / publish</td><td>the seeding crons</td><td>15–30 min</td><td><strong>only while Seeding is ON</strong></td></tr>
            </tbody>
          </table>

          <h4 style={{ marginBottom: 6 }}>Why it stays accurate</h4>
          <ul style={{ marginTop: 0, marginBottom: 0 }}>
            <li><strong>Retrieval, not knowledge</strong> — candidates are ranked by enriched occasion text per garment slot, so the stylist sees on-occasion options, not a random recent slice. It gets <em>better</em> as the catalog grows.</li>
            <li><strong>Grounded</strong> — the stylist can only pick from real, in-stock, gender-correct candidates; gaps are admitted as gaps, never faked.</li>
            <li><strong>Self-healing</strong> — gaps (cockpit) and unmet chat asks (live) both route back into seeding, so coverage compounds over time.</li>
            <li><strong>Safe by default</strong> — generated scenarios are <strong>paused</strong> (test cases, never spend); only gaps or an explicit Approve fetch. Chat demand only queues what we genuinely lack.</li>
          </ul>
        </div>
        <div className="admin-modal-footer">
          <button className="admin-btn admin-btn-primary" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  );
}
