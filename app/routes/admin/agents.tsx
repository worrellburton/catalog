import { useState } from 'react';
import { useNavigate, useSearchParams } from '@remix-run/react';
import SiteCrawlsPanel from '~/components/SiteCrawlsPanel';

type Tab = 'overview' | 'site-crawls';

interface AgentCard {
  id: Tab | 'ai-models' | 'video-generation' | 'product-ads';
  name: string;
  description: string;
  status: 'live' | 'coming-soon';
  to?: string;
  onClick?: () => void;
  icon: string;
}

export default function AdminAgents() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const initialTab = (searchParams.get('tab') as Tab) || 'overview';
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  const setTab = (tab: Tab) => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    if (tab === 'overview') next.delete('tab');
    else next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  const cards: AgentCard[] = [
    {
      id: 'site-crawls',
      name: 'Site Crawls',
      description: 'Crawl e-commerce sites to discover product URLs and ingest them into the catalog.',
      status: 'live',
      onClick: () => setTab('site-crawls'),
      icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
    },
    {
      id: 'ai-models',
      name: 'AI Models',
      description: 'Manage AI creator personas used to generate look content.',
      status: 'live',
      to: '/admin/ai-models',
      icon: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM16 3.13a4 4 0 0 1 0 7.75',
    },
    {
      id: 'video-generation',
      name: 'Video Generation',
      description: 'Generate short-form video creative from product data using Veo.',
      status: 'live',
      to: '/admin/video-generation',
      icon: 'M23 7l-7 5 7 5V7zM14 5H3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z',
    },
    {
      id: 'product-ads',
      name: 'Product Ads',
      description: 'Produce and manage product ad creatives for placement on the feed.',
      status: 'live',
      to: '/admin/product-ads',
      icon: 'M2 7v10M6 5v14M11 4l9 4v12l-9-4z',
    },
  ];

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Agents</h1>
        <p className="admin-page-subtitle">Autonomous agents that ingest, generate, and curate product content</p>
      </div>

      <div className="admin-tabs">
        <button
          className={`admin-tab ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setTab('overview')}
        >
          Overview
        </button>
        <button
          className={`admin-tab ${activeTab === 'site-crawls' ? 'active' : ''}`}
          onClick={() => setTab('site-crawls')}
        >
          Site Crawls
        </button>
      </div>

      {activeTab === 'overview' ? (
        <div className="admin-agents-grid">
          {cards.map((card) => (
            <button
              key={card.id}
              className="admin-agent-card"
              onClick={() => {
                if (card.onClick) card.onClick();
                else if (card.to) navigate(card.to);
              }}
            >
              <div className="admin-agent-card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d={card.icon} />
                </svg>
              </div>
              <div className="admin-agent-card-body">
                <div className="admin-agent-card-head">
                  <span className="admin-agent-card-name">{card.name}</span>
                  <span className={`admin-agent-card-status admin-agent-card-status-${card.status}`}>
                    {card.status === 'live' ? 'Live' : 'Coming soon'}
                  </span>
                </div>
                <p className="admin-agent-card-desc">{card.description}</p>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <SiteCrawlsPanel embedded />
      )}
    </div>
  );
}
