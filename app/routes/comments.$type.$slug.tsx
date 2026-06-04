import { useParams, useNavigate } from '@remix-run/react';
import { useEffect } from 'react';
import CommentsPage from '~/components/CommentsPage';
import { useCommentsEnabled } from '~/hooks/useCommentsEnabled';
import type { CommentTargetType } from '~/services/comments';
import '~/styles/comments.css';

/**
 * Comment thread page: /comments/<type>/<slug> where type is "p" | "l"
 * (product | look). A real route — the Comment button on the product /
 * look surfaces navigates here. Honours the comments_enabled dial.
 */
export default function CommentsRoute() {
  const params = useParams();
  const navigate = useNavigate();
  const enabled = useCommentsEnabled();

  const rawType = params.type;
  const slug = params.slug || '';
  const targetType: CommentTargetType | null =
    rawType === 'p' ? 'product' : rawType === 'l' ? 'look' : null;

  // Unknown target type → there's nothing to comment on; bounce home.
  useEffect(() => {
    if (!targetType) navigate('/', { replace: true });
  }, [targetType, navigate]);

  if (!targetType) return null;

  if (!enabled) {
    return (
      <div className="comments-page">
        <div className="comments-shell">
          <button className="comments-back" onClick={() => navigate('/')} aria-label="Back">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            <span>Back</span>
          </button>
          <div className="comments-empty">Comments are currently turned off.</div>
        </div>
      </div>
    );
  }

  return <CommentsPage targetType={targetType} slug={slug} />;
}
