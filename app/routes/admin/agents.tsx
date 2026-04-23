import { useState, useEffect } from 'react';
import { useSearchParams } from '@remix-run/react';
import SiteCrawlsPanel from '~/components/SiteCrawlsPanel';
import CollectionCrawlsPanel from '~/components/CollectionCrawlsPanel';
import ProductCrawlsPanel from '~/components/ProductCrawlsPanel';
import ProfileCrawlsPanel from '~/components/ProfileCrawlsPanel';
import VideoGenerationPanel from '~/components/VideoGenerationPanel';
import ProductAdsPanel from '~/components/ProductAdsPanel';
import { listCrawlJobs, type CrawlJob } from '~/services/site-crawls';
import { getGeneratedVideos, type GeneratedVideo } from '~/services/video-generation';
import { getProductAds, type ProductAd } from '~/services/product-ads';

type Tab = 'overview' | 'crawls' | 'video-gen';
type CrawlSubTab = 'full-site' | 'collections' | 'profiles' | 'products';
type VideoSubTab = 'product-ads' | 'look-videos';

export default function AdminAgents() {
  const [searchParams, setSearchParams] = useSearchParams();

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

  const [crawls, setCrawls] = useState<CrawlJob[]>([]);
  const [videos, setVideos] = useState<GeneratedVideo[]>([]);
  const [ads, setAds] = useState<ProductAd[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    if (activeTab !== 'overview') return;
    setStatsLoading(true);
    Promise.all([
      listCrawlJobs().catch(() => [] as CrawlJob[]),
      getGeneratedVideos().catch(() => [] as GeneratedVideo[]),
      getProductAds().catch(() => [] as ProductAd[]),
    ]).then(([c, v, a]) => {
      setCrawls(c);
      setVideos(v);
      setAds(a);
      setStatsLoading(false);
    });
  }, [activeTab]);

  const isToday = (iso: string | null | undefined) => {
    if (!iso) return false;
    const d = new Date(iso);
    const now = new Date();
    return d.getFullYear() === now.getFullYear()
      && d.getMonth() === now.getMonth()
      && d.getDate() === now.getDate();
  };

  const indexersToday = crawls.filter(c => isToday(c.completed_at));
  const indexerStats = {
    completedToday: indexersToday.length,
    successToday: indexersToday.filter(c => c.status === 'done').length,
    failedToday: indexersToday.filter(c => c.status === 'failed').length,
    activeNow: crawls.filter(c => c.status === 'crawling').length,
    totalUrls: crawls.reduce((sum, c) => sum + (c.total_urls || 0), 0),
  };

  const allContent = [...videos, ...ads];
  const videoStats = {
    total: allContent.length,
    done: allContent.filter(v => v.status === 'done' || v.status === 'live').length,
    failed: allContent.filter(v => v.status === 'failed').length,
    generating: allContent.filter(v => v.status === 'generating' || v.status === 'pending' || v.status === 'uploading').length,
    totalCost: allContent.reduce((sum, v) => sum + (v.cost_usd || 0), 0),
  };

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
          Indexers
        </button>
        <button
          className={`admin-tab ${activeTab === 'video-gen' ? 'active' : ''}`}
          onClick={() => setTab('video-gen')}
        >
          Creative
        </button>
      </div>

      {activeTab === 'overview' ? (
        <>
          <div className="admin-stats-grid" style={{ marginBottom: 16 }}>
            <div className="admin-stat-card">
              <span className="admin-stat-value">{statsLoading ? '…' : indexerStats.completedToday}</span>
              <span className="admin-stat-label">Indexers completed today</span>
            </div>
            <div className="admin-stat-card">
              <span className="admin-stat-value" style={{ color: '#16a34a' }}>{statsLoading ? '…' : indexerStats.successToday}</span>
              <span className="admin-stat-label">Successful today</span>
            </div>
            <div className="admin-stat-card">
              <span className="admin-stat-value" style={{ color: '#dc2626' }}>{statsLoading ? '…' : indexerStats.failedToday}</span>
              <span className="admin-stat-label">Failed today</span>
            </div>
            <div className="admin-stat-card">
              <span className="admin-stat-value">{statsLoading ? '…' : indexerStats.activeNow}</span>
              <span className="admin-stat-label">Active indexers</span>
            </div>
            <div className="admin-stat-card">
              <span className="admin-stat-value">{statsLoading ? '…' : indexerStats.totalUrls.toLocaleString()}</span>
              <span className="admin-stat-label">URLs discovered</span>
            </div>
          </div>
          <div className="admin-stats-grid" style={{ marginBottom: 24 }}>
            <div className="admin-stat-card">
              <span className="admin-stat-value">{statsLoading ? '…' : videoStats.total}</span>
              <span className="admin-stat-label">Videos generated</span>
            </div>
            <div className="admin-stat-card">
              <span className="admin-stat-value" style={{ color: '#16a34a' }}>{statsLoading ? '…' : videoStats.done}</span>
              <span className="admin-stat-label">Done</span>
            </div>
            <div className="admin-stat-card">
              <span className="admin-stat-value" style={{ color: '#dc2626' }}>{statsLoading ? '…' : videoStats.failed}</span>
              <span className="admin-stat-label">Failed</span>
            </div>
            <div className="admin-stat-card">
              <span className="admin-stat-value">{statsLoading ? '…' : videoStats.generating}</span>
              <span className="admin-stat-label">In progress</span>
            </div>
            <div className="admin-stat-card">
              <span className="admin-stat-value">${statsLoading ? '…' : videoStats.totalCost.toFixed(2)}</span>
              <span className="admin-stat-label">Total cost</span>
            </div>
          </div>
        </>
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
              className={`admin-subtab ${crawlSub === 'profiles' ? 'active' : ''}`}
              onClick={() => setCrawlSubTab('profiles')}
            >
              Profiles
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
          {crawlSub === 'profiles' && <ProfileCrawlsPanel />}
          {crawlSub === 'products' && <ProductCrawlsPanel />}
        </div>
      ) : (
        <div className="admin-agent-subsection">
          <div className="admin-subtabs">
            <button
              className={`admin-subtab ${videoSub === 'product-ads' ? 'active' : ''}`}
              onClick={() => setVideoSubTab('product-ads')}
            >
              Products
            </button>
            <button
              className={`admin-subtab ${videoSub === 'look-videos' ? 'active' : ''}`}
              onClick={() => setVideoSubTab('look-videos')}
            >
              Looks
            </button>
          </div>

          {videoSub === 'product-ads' && <ProductAdsPanel embedded />}
          {videoSub === 'look-videos' && <VideoGenerationPanel embedded />}
        </div>
      )}
    </div>
  );
}
