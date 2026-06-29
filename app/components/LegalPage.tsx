import { useEscapeKey } from '~/hooks/useEscapeKey';
import '~/styles/profile-page.css';

export type LegalKind = 'privacy' | 'terms';

interface LegalPageProps {
  kind: LegalKind;
  onClose: () => void;
}

const LAST_UPDATED = 'June 29, 2026';
const CONTACT_EMAIL = 'support@catalog.shop';

interface Section {
  heading: string;
  body: string[];
}

// ponytail: legal copy is a sensible starting template, not lawyer-reviewed —
// have counsel review the placeholders (contact email, governing law) before launch.
const PRIVACY: Section[] = [
  {
    heading: 'Overview',
    body: [
      'Catalog ("we", "us") is a visual shopping app for browsing fashion looks and the products in them. This policy explains what we collect, how we use it, and the choices you have.',
    ],
  },
  {
    heading: 'Information we collect',
    body: [
      'Account information you provide: email address, name, profile photo, and optional social handles.',
      'Profile details you choose to add — such as height, weight, age range, and gender — which we use to show more relevant looks and to power virtual try-on.',
      'Activity in the app: looks you view, searches you run, and items you bookmark.',
      'Device and log data: browser type, IP address, and basic diagnostics needed to operate and secure the service.',
    ],
  },
  {
    heading: 'How we use your information',
    body: [
      'To run the app, personalize your daily feed, and remember your saved looks and products.',
      'To improve our content, search, and recommendations, and to keep the service safe and reliable.',
      'To communicate with you about your account or important changes.',
    ],
  },
  {
    heading: 'How we share information',
    body: [
      'With brands and creators in aggregate (for example, how many people viewed or saved a look). We do not sell your personal information.',
      'With service providers who host and operate the app on our behalf, under confidentiality obligations.',
      'When required by law, or to protect the rights, safety, and security of our users and the service.',
    ],
  },
  {
    heading: 'Cookies and local storage',
    body: [
      'We use your device’s local storage to keep you signed in and to save your bookmarks. Clearing your browser data will remove locally stored bookmarks.',
    ],
  },
  {
    heading: 'Data retention',
    body: [
      'We keep your information for as long as your account is active or as needed to provide the service. You can ask us to delete your account at any time.',
    ],
  },
  {
    heading: 'Your choices and rights',
    body: [
      'You can review and update your profile details directly in the app from your profile.',
      'You may request access to, correction of, or deletion of your personal information by contacting us.',
    ],
  },
  {
    heading: 'Children’s privacy',
    body: [
      'Catalog is not directed to children under 13, and we do not knowingly collect information from them.',
    ],
  },
  {
    heading: 'Security',
    body: [
      'We use reasonable technical and organizational measures to protect your information, though no method of transmission or storage is completely secure.',
    ],
  },
  {
    heading: 'Changes to this policy',
    body: [
      'We may update this policy from time to time. When we do, we will revise the date above and, where appropriate, notify you in the app.',
    ],
  },
  {
    heading: 'Contact',
    body: [
      `Questions about this policy? Reach us at ${CONTACT_EMAIL}.`,
    ],
  },
];

const TERMS: Section[] = [
  {
    heading: 'Acceptance of these terms',
    body: [
      'By using Catalog, you agree to these Terms of Service. If you do not agree, please do not use the app.',
    ],
  },
  {
    heading: 'Eligibility',
    body: [
      'You must be at least 13 years old (or the minimum age required in your country) to use Catalog.',
    ],
  },
  {
    heading: 'Your account',
    body: [
      'You are responsible for the activity on your account and for keeping your login secure. Tell us right away if you suspect unauthorized use.',
    ],
  },
  {
    heading: 'Acceptable use',
    body: [
      'Do not misuse the app: no scraping, reverse engineering, interfering with its operation, infringing others’ rights, or uploading unlawful or harmful content.',
    ],
  },
  {
    heading: 'Content and intellectual property',
    body: [
      'Looks, videos, and other content in the app are owned by Catalog, its creators, or its partners and are protected by intellectual-property laws.',
      'Anything you submit remains yours, but you grant us a license to host and display it as needed to operate the service.',
    ],
  },
  {
    heading: 'Shopping and third-party brands',
    body: [
      'Catalog links you out to brand and retailer websites. Those purchases are made directly with the brand — Catalog is not the seller and is not responsible for orders, payments, shipping, or returns.',
      'Product details, prices, and availability are provided by the brands and may change at any time.',
    ],
  },
  {
    heading: 'Disclaimers',
    body: [
      'The app is provided "as is" and "as available", without warranties of any kind, to the fullest extent permitted by law.',
    ],
  },
  {
    heading: 'Limitation of liability',
    body: [
      'To the extent permitted by law, Catalog is not liable for any indirect, incidental, or consequential damages arising from your use of the app.',
    ],
  },
  {
    heading: 'Termination',
    body: [
      'We may suspend or end your access if you violate these terms or misuse the service. You can stop using Catalog at any time.',
    ],
  },
  {
    heading: 'Changes to these terms',
    body: [
      'We may update these terms from time to time. Continued use of the app after changes take effect means you accept the updated terms.',
    ],
  },
  {
    heading: 'Contact',
    body: [
      `Questions about these terms? Reach us at ${CONTACT_EMAIL}.`,
    ],
  },
];

export default function LegalPage({ kind, onClose }: LegalPageProps) {
  useEscapeKey(onClose);

  const title = kind === 'privacy' ? 'Privacy Policy' : 'Terms of Service';
  const sections = kind === 'privacy' ? PRIVACY : TERMS;

  return (
    <div className="legal-page-overlay">
      <div className="legal-page-container">
        <div className="legal-page-header">
          <button className="profile-page-back" onClick={onClose} aria-label="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
            </svg>
          </button>
          <h1 className="profile-page-title">{title}</h1>
        </div>

        <p className="legal-page-meta">Last updated: {LAST_UPDATED}</p>

        <div className="legal-page-body">
          {sections.map((s) => (
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
