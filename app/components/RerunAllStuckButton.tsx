import { useState } from 'react';
import { checkBudgetForRerun, getAiBudget, setAiBudget, type BudgetCheck } from '~/utils/aiBudget';

interface BaseProps {
  /** How many jobs would be rerun. Button is hidden when 0. */
  stuckCount: number;
  /** Async handler that actually retries each job. */
  onRerunAll: () => Promise<void>;
  /** Optional label override - defaults to "Rerun all stuck (N)". */
  label?: string;
}

interface BudgetGatedProps extends BaseProps {
  /**
   * Jobs that will be rerun, used for cost estimation. Provide this to
   * enable the balance check; omit for free operations like crawls.
   */
  jobs: Array<{ model?: string | null; veo_model?: string | null }>;
  budgetGated: true;
}

interface FreeProps extends BaseProps {
  budgetGated?: false;
  jobs?: never;
}

type Props = BudgetGatedProps | FreeProps;

export default function RerunAllStuckButton(props: Props) {
  const { stuckCount, onRerunAll, label } = props;
  const [open, setOpen] = useState(false);
  const [check, setCheck] = useState<BudgetCheck | null>(null);
  const [running, setRunning] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');

  if (stuckCount === 0) return null;

  const handleClick = async () => {
    if (props.budgetGated) {
      const c = await checkBudgetForRerun(props.jobs);
      setCheck(c);
      setBudgetInput(String(getAiBudget()));
      setOpen(true);
    } else {
      // No balance check - just confirm + run.
      if (!window.confirm(`Rerun ${stuckCount} stuck job${stuckCount === 1 ? '' : 's'}?`)) return;
      setRunning(true);
      try {
        await onRerunAll();
      } finally {
        setRunning(false);
      }
    }
  };

  const handleConfirm = async () => {
    setRunning(true);
    try {
      await onRerunAll();
      setOpen(false);
    } finally {
      setRunning(false);
    }
  };

  const handleSaveBudget = () => {
    const n = Number(budgetInput);
    if (Number.isFinite(n) && n > 0) {
      setAiBudget(n);
      // Re-run check with new budget
      checkBudgetForRerun(props.budgetGated ? props.jobs : []).then(setCheck);
    }
  };

  return (
    <>
      <button
        className="admin-btn admin-btn-secondary"
        onClick={handleClick}
        disabled={running}
        style={{ fontSize: 12, color: '#dc2626', borderColor: '#fca5a5' }}
        title={`Rerun all jobs that have exceeded their typical wall-clock by 2×`}
      >
        {running ? 'Rerunning…' : (label || `↺ Rerun all stuck (${stuckCount})`)}
      </button>

      {open && check && (
        <div className="admin-modal-overlay" onClick={() => !running && setOpen(false)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="admin-modal-header">
              <h3>Rerun stuck jobs</h3>
              <button className="admin-modal-close" onClick={() => setOpen(false)} disabled={running}>×</button>
            </div>
            <div className="admin-modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px 16px', fontSize: 13, marginBottom: 16 }}>
                <span style={{ color: '#666' }}>Stuck jobs</span>
                <span style={{ fontWeight: 600 }}>{check.jobCount}</span>

                <span style={{ color: '#666' }}>Estimated cost</span>
                <span style={{ fontWeight: 600 }}>${check.estimatedCostUsd.toFixed(2)}</span>

                <span style={{ color: '#666' }}>Spent so far</span>
                <span>${check.spentUsd.toFixed(2)}</span>

                <span style={{ color: '#666' }}>Budget</span>
                <span>${check.budgetUsd.toFixed(2)}</span>

                <span style={{ color: '#666', borderTop: '1px solid #eee', paddingTop: 8 }}>Remaining</span>
                <span style={{
                  fontWeight: 700,
                  color: check.hasFunds ? '#16a34a' : '#dc2626',
                  borderTop: '1px solid #eee',
                  paddingTop: 8,
                }}>
                  ${check.remainingUsd.toFixed(2)}
                </span>
              </div>

              {!check.hasFunds && (
                <div style={{
                  background: '#fef2f2',
                  border: '1px solid #fca5a5',
                  borderRadius: 6,
                  padding: '10px 14px',
                  fontSize: 13,
                  color: '#b91c1c',
                  marginBottom: 16,
                }}>
                  <strong>Low balance.</strong> Rerunning these jobs would cost
                  ${check.estimatedCostUsd.toFixed(2)} but only ${check.remainingUsd.toFixed(2)}
                  {' '}of your ${check.budgetUsd.toFixed(2)} budget remains. Top up the budget
                  below or cancel and rerun individual jobs instead.
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>
                    Monthly Gen-AI budget (USD)
                  </label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={budgetInput}
                    onChange={(e) => setBudgetInput(e.target.value)}
                    style={{
                      width: '100%', padding: '6px 10px', borderRadius: 6,
                      border: '1px solid #e5e7eb', fontSize: 13,
                    }}
                  />
                </div>
                <button className="admin-btn admin-btn-secondary" onClick={handleSaveBudget}>
                  Update
                </button>
              </div>
            </div>
            <div className="admin-modal-footer">
              <button className="admin-btn admin-btn-secondary" onClick={() => setOpen(false)} disabled={running}>
                Cancel
              </button>
              <button
                className="admin-btn admin-btn-primary"
                onClick={handleConfirm}
                disabled={running || !check.hasFunds}
              >
                {running ? 'Rerunning…' : `Rerun ${check.jobCount} job${check.jobCount === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
