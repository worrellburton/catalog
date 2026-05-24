import { supabase } from '~/utils/supabase';

export interface ShareSettings {
  title: string;
  description: string;
  imageUrl: string;
  siteName: string;
  url: string;
}

export const SHARE_DEFAULTS: ShareSettings = {
  title: 'catalog',
  description: 'A creator-powered shopping platform where you discover products through curated looks.',
  imageUrl: '',
  siteName: 'catalog',
  url: 'https://catalog.shop',
};

const KEYS = {
  title: 'share.title',
  description: 'share.description',
  imageUrl: 'share.image_url',
  siteName: 'share.site_name',
  url: 'share.url',
} as const;

export async function loadShareSettings(): Promise<ShareSettings> {
  if (!supabase) return SHARE_DEFAULTS;
  const { data } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', Object.values(KEYS));
  const map = new Map<string, string>((data ?? []).map((r: any) => [r.key, r.value ?? '']));
  return {
    title: map.get(KEYS.title) || SHARE_DEFAULTS.title,
    description: map.get(KEYS.description) || SHARE_DEFAULTS.description,
    imageUrl: map.get(KEYS.imageUrl) || SHARE_DEFAULTS.imageUrl,
    siteName: map.get(KEYS.siteName) || SHARE_DEFAULTS.siteName,
    url: map.get(KEYS.url) || SHARE_DEFAULTS.url,
  };
}

export async function saveShareSettings(s: ShareSettings): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const rows = [
    { key: KEYS.title, value: s.title, updated_at: new Date().toISOString() },
    { key: KEYS.description, value: s.description, updated_at: new Date().toISOString() },
    { key: KEYS.imageUrl, value: s.imageUrl, updated_at: new Date().toISOString() },
    { key: KEYS.siteName, value: s.siteName, updated_at: new Date().toISOString() },
    { key: KEYS.url, value: s.url, updated_at: new Date().toISOString() },
  ];
  const { error } = await supabase.from('app_settings').upsert(rows);
  if (error) throw error;
}

export async function uploadShareImage(file: File): Promise<string> {
  if (!supabase) throw new Error('Supabase not configured');
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const path = `og/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from('share-images')
    .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from('share-images').getPublicUrl(path);
  return data.publicUrl;
}
