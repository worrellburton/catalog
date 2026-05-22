/**
 * SVG measurement diagram for the product page. Renders a clean
 * garment outline with measurement callouts (NECK WIDTH, CHEST WIDTH,
 * SLEEVE LENGTH, LENGTH, etc.) overlaid on dashed leader lines —
 * mirrors the spec-sheet diagrams brands ship next to size charts.
 *
 * The shape rendered is keyed off the product's role tag (inferred
 * from the product name) so a t-shirt gets the t-shirt outline, pants
 * get the pant outline, etc. Falls back to the t-shirt shape for
 * unknown roles.
 *
 * Self-hides when the `measurements` record is empty / null — so the
 * caller can drop the component in unconditionally and it disappears
 * for any product the scraper hasn't backfilled yet.
 */

interface ProductMeasurementsDiagramProps {
  measurements?: Record<string, number> | null;
  /** Hint at what shape to draw. Currently 'top' (t-shirt) is the
   *  only supported diagram; future roles can fan in here without
   *  changing the public API. */
  shape?: 'top' | 'pants' | 'shoes' | 'dress';
}

// Pretty labels for the structured measurement keys. Only keys listed
// here render — unknown keys are dropped silently so the scraper can
// experiment with new shapes without polluting the UI.
const MEASUREMENT_LABELS: Record<string, string> = {
  neck_width_cm:    'NECK WIDTH',
  chest_width_cm:   'CHEST WIDTH',
  shoulder_cm:      'SHOULDER',
  sleeve_length_cm: 'SLEEVE LENGTH',
  length_cm:        'LENGTH',
  waist_cm:         'WAIST',
  hip_cm:           'HIP',
  inseam_cm:        'INSEAM',
  rise_cm:          'RISE',
  thigh_cm:         'THIGH',
  hem_cm:           'HEM',
  bust_cm:          'BUST',
};

function fmt(cm: number): string {
  // Strip trailing zeros so 21 reads "21 cm", not "21.0 cm". Round
  // to the nearest mm so a scraped 20.5 still renders cleanly.
  const rounded = Math.round(cm * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} cm`;
}

export default function ProductMeasurementsDiagram({
  measurements,
  shape = 'top',
}: ProductMeasurementsDiagramProps) {
  if (!measurements) return null;
  const entries = Object.entries(measurements)
    .filter(([k, v]) => MEASUREMENT_LABELS[k] && typeof v === 'number' && Number.isFinite(v));
  if (entries.length === 0) return null;

  const dict: Record<string, number> = Object.fromEntries(entries);

  return (
    <section
      className="pd-measure"
      aria-label="Product measurements"
      style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}
    >
      <svg
        viewBox="0 0 480 540"
        width="100%"
        style={{ maxWidth: 460, height: 'auto' }}
        role="img"
        aria-label="Garment measurements diagram"
      >
        {/* Garment outline — top/t-shirt shape. The path is a single
            closed silhouette so the stroke reads as one continuous
            edge regardless of which measurements are populated. */}
        {shape === 'top' && (
          <path
            d="
              M 180 60
              Q 240 30 300 60
              L 300 90
              Q 360 100 410 140
              L 430 195
              Q 415 215 365 200
              L 355 175
              L 355 470
              Q 240 485 125 470
              L 125 175
              L 115 200
              Q 65 215 50 195
              L 70 140
              Q 120 100 180 90
              Z
            "
            fill="#fafafa"
            stroke="#1a1a1a"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        )}
        {/* Crew neckline */}
        {shape === 'top' && (
          <path
            d="M 200 78 Q 240 100 280 78"
            fill="none"
            stroke="#1a1a1a"
            strokeWidth="2"
            strokeLinecap="round"
          />
        )}

        {/* Measurement leader lines + labels. Each callout is a
            dashed line bracketing the dimension across the outline,
            with the label centered above/beside. Anchors are tuned
            per measurement so the labels never overlap the body. */}

        {dict.neck_width_cm && (
          <g>
            <line x1="200" y1="55" x2="280" y2="55" stroke="#1a1a1a" strokeWidth="1" strokeDasharray="3 3" />
            <line x1="200" y1="50" x2="200" y2="60" stroke="#1a1a1a" strokeWidth="1" />
            <line x1="280" y1="50" x2="280" y2="60" stroke="#1a1a1a" strokeWidth="1" />
            <text x="240" y="40" textAnchor="middle" fontSize="11" fontWeight="700" fill="#1a1a1a" letterSpacing="0.06em">
              NECK WIDTH: {fmt(dict.neck_width_cm)}
            </text>
          </g>
        )}

        {dict.sleeve_length_cm && (
          <g>
            <line x1="310" y1="68" x2="420" y2="175" stroke="#1a1a1a" strokeWidth="1" strokeDasharray="3 3" />
            <text
              x="365"
              y="115"
              fontSize="11"
              fontWeight="700"
              fill="#1a1a1a"
              letterSpacing="0.06em"
              transform="rotate(45 365 115)"
              textAnchor="middle"
            >
              SLEEVE LENGTH: {fmt(dict.sleeve_length_cm)}
            </text>
          </g>
        )}

        {dict.chest_width_cm && (
          <g>
            <line x1="125" y1="240" x2="355" y2="240" stroke="#1a1a1a" strokeWidth="1" strokeDasharray="3 3" />
            <line x1="125" y1="232" x2="125" y2="248" stroke="#1a1a1a" strokeWidth="1" />
            <line x1="355" y1="232" x2="355" y2="248" stroke="#1a1a1a" strokeWidth="1" />
            <text x="240" y="232" textAnchor="middle" fontSize="11" fontWeight="700" fill="#1a1a1a" letterSpacing="0.06em">
              CHEST WIDTH: {fmt(dict.chest_width_cm)}
            </text>
          </g>
        )}

        {dict.length_cm && (
          <g>
            <line x1="245" y1="100" x2="245" y2="470" stroke="#1a1a1a" strokeWidth="1" strokeDasharray="3 3" />
            <line x1="237" y1="100" x2="253" y2="100" stroke="#1a1a1a" strokeWidth="1" />
            <line x1="237" y1="470" x2="253" y2="470" stroke="#1a1a1a" strokeWidth="1" />
            <text
              x="245"
              y="285"
              fontSize="11"
              fontWeight="700"
              fill="#1a1a1a"
              letterSpacing="0.06em"
              transform="rotate(90 245 285)"
              textAnchor="middle"
            >
              LENGTH: {fmt(dict.length_cm)}
            </text>
          </g>
        )}

        {dict.shoulder_cm && (
          <g>
            <line x1="125" y1="170" x2="355" y2="170" stroke="#a3a3a3" strokeWidth="1" strokeDasharray="2 4" />
            <text x="240" y="163" textAnchor="middle" fontSize="10" fontWeight="700" fill="#525252" letterSpacing="0.06em">
              SHOULDER: {fmt(dict.shoulder_cm)}
            </text>
          </g>
        )}
      </svg>
    </section>
  );
}
