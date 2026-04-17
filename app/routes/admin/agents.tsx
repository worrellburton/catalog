import { useState } from 'react';
import { useNavigate, useSearchParams } from '@remix-run/react';
import SiteCrawlsPanel from '~/components/SiteCrawlsPanel';
import CollectionCrawlsPanel from '~/components/CollectionCrawlsPanel';
import ProductCrawlsPanel from '~/components/ProductCrawlsPanel';
import VideoGenerationPanel from '~/components/VideoGenerationPanel';
import ProductAdsPanel from '~/components/ProductAdsPanel';

type Tab = 'overview' | 'crawls' | 'video-gen';
type CrawlSubTab = 'full-site' | 'collections' | 'products';
type VideoSubTab = 'product-ads' | 'look-videos';

interface AgentCard {
  id: string;
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

  const rawTab = searchParams.get('tab') as string;
  const initialTab: Tab =
    rawTab === 'crawls' || rawTab === 'site-crawls' ? 'crawls'
    : rawTab === 'video-gen' ? 'video-gen'
    : 'overview';
  const initialCrawlSub = (searchParams.get('sub') as CrawlSubTab) || 'full-site';
  const initialVideoSub = (searchParams.get('sub') as VideoSubTab) || 'product-ads';

  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [crawlSub, setCrawlSub] = useState<CrawlSubTab>(initialCrawlSub);
  const [videoSub, setVideoSub] = useState<VideoSubTab>(initialVideoSub);

  const setTab = (tab: Tab) => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    if (tab === 'overview') {
      next.delete('tab');
      next.delete('sub');
    } else {
      next.set('tab', tab);
      next.delete('sub');
    }
    setSearchParams(next, { replace: true });
  };

  const setCrawlSubTab = (sub: CrawlSubTab) => {
    setCrawlSub(sub);
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'crawls');
    next.set('sub', sub);
    setSearchParams(next, { replace: true });
  };

  const setVideoSubTab = (sub: VideoSubTab) => {
    setVideoSub(sub);
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'video-gen');
    next.set('sub', sub);
    setSearchParams(next, { replace: true });
  };

  const cards: AgentCard[] = [
    {
      id: 'crawls',
      name: 'Crawls',
      description: 'Crawl e-commerce sites, collections, and individual products to populate the catalog.',
      status: 'live',
      onClick: () => setTab('crawls'),
      icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
    },
    {
      id: 'video-gen',
      name: 'Video Gen',
      description: 'Generate AI video ads and look videos from product data using Veo + Claude.',
      status: 'live',
      onClick: () => setTab('video-gen'),
      icon: 'M23 7l-7 5 7 5V7zM14 5H3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z',
    },
    {
      id: 'ai-models',
      name: 'AI Models',
      description: 'Manage AI creator personas used to generate look content.',
      status: 'live',
      to: '/admin/ai-models',
      icon: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM16 3.13a4 4 0 0 1 0 7.75',
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
          className={`admin-tab ${activeTab === 'crawls' ? 'active' : ''}`}
          onClick={() => setTab('crawls')}
        >
          Crawls
        </button>
        <button
          className={`admin-tab ${activeTab === 'video-gen' ? 'active' : ''}`}
          onClick={() => setTab('video-gen')}
        >
          Video Gen
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
      ) : activeTab === 'crawls' ? (
        <div className="admin-agent-subsection">
          <div className="admin-subtabs">
            <button
              className={`admin-subtab ${crawlSub === 'full-site' ? 'active' : ''}`}
              onClick={() => setCrawlSubTab('full-site')}
            >
              Full Site
            </button>
            <button
              className={`admin-subtab ${crawlSub === 'collections' ? 'active' : ''}`}
              onClick={() => setCrawlSubTab('collections')}
            >
              Collections
            </button>
            <button
              className={`admin-subtab ${crawlSub === 'products' ? 'active' : ''}`}
              onClick={() => setCrawlSubTab('products')}
            >
              Products
            </button>
          </div>

          {crawlSub === 'full-site' && <SiteCrawlsPanel embedded />}
          {crawlSub === 'collections' && <CollectionCrawlsPanel />}
          {crawlSub === 'products' && <ProductCrawlsPanel />}
        </div>
      ) : (
        <div className="admin-agent-subsection">
          <div className="admin-subtabs">
            <button
              className={`admin-subtab ${videoSub === 'product-ads' ? 'active' : ''}`}
              onClick={() => setVideoSubTab('product-ads')}
            >
              Product Ads
            </button>
            <button
              className={`admin-subtab ${videoSub === 'look-videos' ? 'active' : ''}`}
              onClick={() => setVideoSubTab('look-videos')}
            >
              Look Videos
            </button>
          </div>

          {videoSub === 'product-ads' && <ProductAdsPanel embedded />}
          {videoSub === 'look-videos' && <VideoGenerationPanel embedded />}
        </div>
      )}
    </div>
  );
}
