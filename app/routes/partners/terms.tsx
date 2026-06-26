// ponytail: static prose, no scope/data — usePartnersContext only for the brand name in the intro.
import { usePartnersContext } from '~/hooks/useBrandMembership';

const UPDATED = 'June 2026';

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: '1. Acceptance of Terms',
    body: [
      'These Terms & Conditions govern your access to and use of the Catalog Partner Portal (the “Portal”) as a brand partner. By creating an account, connecting a storefront, or otherwise using the Portal, you agree to be bound by these terms on behalf of your brand.',
      'If you do not agree, you may not use the Portal. We may update these terms from time to time; continued use after an update constitutes acceptance of the revised terms.',
    ],
  },
  {
    title: '2. Acceptable Use',
    body: [
      'You agree to use the Portal only for lawful purposes and in accordance with these terms. You may not upload content that is unlawful, infringing, deceptive, or that misrepresents your products, pricing, or availability.',
      'You may not attempt to disrupt the service, circumvent access controls, scrape data beyond your own brand’s scope, or access another brand’s data. We may suspend access for any activity we reasonably believe violates these terms.',
    ],
  },
  {
    title: '3. Product & Content Ownership',
    body: [
      'You retain ownership of the product listings, media, descriptions, and brand assets you submit. You grant Catalog a non-exclusive, worldwide, royalty-free license to host, display, reformat, and promote that content across the Catalog app and its marketing surfaces for as long as your content is active on the platform.',
      'You represent that you hold all rights necessary to grant this license and that your content does not infringe any third party’s intellectual property, publicity, or privacy rights.',
    ],
  },
  {
    title: '4. Commissions & Payments',
    body: [
      'Commissions, fees, and payout schedules are set out in your plan and any separately agreed commercial terms. Sales attributed through Catalog tracking links are subject to the applicable commission rate in effect at the time of the sale.',
      'Payouts are made to the payment method on file, subject to verification, minimum thresholds, refunds, chargebacks, and applicable taxes. You are responsible for the accuracy of your billing and payout details and for any taxes arising from amounts paid to you.',
    ],
  },
  {
    title: '5. Data',
    body: [
      'Analytics, audience insights, and performance data shown in the Portal are provided for your use in managing your brand presence. Aggregated and anonymized data may be used by Catalog to operate and improve the platform.',
      'Each brand’s data is scoped to that brand. You must not export, share, or use another brand’s data, and you must handle any shopper data you receive in compliance with applicable privacy laws.',
    ],
  },
  {
    title: '6. Termination',
    body: [
      'You may stop using the Portal at any time. We may suspend or terminate your access if you breach these terms, fail to pay amounts due, or if we discontinue the service.',
      'On termination, your active listings may be removed from the Catalog app. Amounts properly earned before termination remain payable, and provisions that by their nature should survive (ownership, liability, payment) continue to apply.',
    ],
  },
  {
    title: '7. Limitation of Liability',
    body: [
      'The Portal is provided “as is” without warranties of any kind. Catalog does not guarantee uninterrupted availability, specific sales results, or that the service will be error-free.',
      'To the maximum extent permitted by law, Catalog is not liable for indirect, incidental, or consequential damages, and our total liability arising from your use of the Portal is limited to the fees you paid to Catalog in the three months preceding the claim.',
    ],
  },
];

export default function PartnersTerms() {
  const { brand } = usePartnersContext();

  return (
    <div style={{ padding: 24, maxWidth: 760 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>Terms &amp; Conditions</h1>
      <p style={{ fontSize: 13, color: '#8b8b93', margin: '0 0 24px' }}>
        Last updated {UPDATED}. These terms apply to {brand.name}’s use of the Catalog Partner Portal.
      </p>

      <div style={{ padding: 24, borderRadius: 14, border: '1px solid #ececef', background: '#fff' }}>
        {SECTIONS.map((s, i) => (
          <section key={s.title} style={{ marginTop: i === 0 ? 0 : 24 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1f', margin: '0 0 8px' }}>{s.title}</h2>
            {s.body.map((p, j) => (
              <p key={j} style={{ fontSize: 13, lineHeight: 1.65, color: '#4a4a52', margin: j === 0 ? '0' : '10px 0 0' }}>
                {p}
              </p>
            ))}
          </section>
        ))}
      </div>

      <p style={{ fontSize: 12, color: '#8b8b93', margin: '20px 0 0' }}>
        Questions about these terms? Reach out to your Catalog partner contact.
      </p>
    </div>
  );
}
