// Support page — the destination for the App Store Connect Support URL
// (guideline 1.5 requires it to carry real support information, not the
// marketing landing page). Mirrors LegalPage's markup and classes verbatim so
// it matches /privacy and /terms without a new stylesheet.
import { useEscapeKey } from '~/hooks/useEscapeKey';
import '~/styles/profile-page.css';

const CONTACT_EMAIL = 'support@catalog.shop';

interface Section {
  heading: string;
  body: string[];
}

const SECTIONS: Section[] = [
  {
    heading: 'What Catalog is',
    body: [
      'Catalog is a visual shopping app for browsing fashion looks and the products in them. You can follow creators, save looks, and see outfits rendered on you.',
    ],
  },
  {
    heading: 'Get help',
    body: [
      `Email us at ${CONTACT_EMAIL} and we will reply within two business days.`,
      'Please include the email address on your account and, if you are reporting a problem, what you were doing when it happened.',
    ],
  },
  {
    heading: 'Delete your account',
    body: [
      'Open the app, tap your profile photo in the top right, and choose "Delete account". This permanently deletes your account and the photos you uploaded.',
      `If you cannot access the app, email ${CONTACT_EMAIL} from the address on your account and we will delete it for you.`,
    ],
  },
  {
    heading: 'Privacy and terms',
    body: [
      'Our Privacy Policy is at catalog.shop/privacy and our Terms of Service are at catalog.shop/terms.',
    ],
  },
];

interface SupportPageProps {
  onClose: () => void;
}

export default function SupportPage({ onClose }: SupportPageProps) {
  useEscapeKey(onClose);

  return (
    <div className="legal-page-overlay">
      <div className="legal-page-container">
        <div className="legal-page-header">
          <button className="profile-page-back" onClick={onClose} aria-label="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
            </svg>
          </button>
          <h1 className="profile-page-title">Support</h1>
        </div>

        <div className="legal-page-body">
          {SECTIONS.map((s) => (
            <section className="legal-page-section" key={s.heading}>
              <h2 className="legal-page-h">{s.heading}</h2>
              {s.body.map((p, i) => (
                <p className="legal-page-p" key={i}>{p}</p>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
