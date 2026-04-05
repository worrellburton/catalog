import { supabase } from '~/utils/supabase';

export interface PlatformStats {
  totalUsers: number;
  creators: number;
  totalLooks: number;
  products: number;
  searchesToday: number;
  bookmarks: number;
}

export async function getPlatformStats(): Promise<PlatformStats> {
  if (!supabase) {
    return { totalUsers: 0, creators: 0, totalLooks: 0, products: 0, searchesToday: 0, bookmarks: 0 };
  }

  const [profilesRes, creatorsRes, looksRes, productsRes] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('creators').select('id', { count: 'exact', head: true }),
    supabase.from('looks').select('id', { count: 'exact', head: true }),
    supabase.from('products').select('id', { count: 'exact', head: true }),
  ]);

  return {
    totalUsers: profilesRes.count || 0,
    creators: creatorsRes.count || 0,
    totalLooks: looksRes.count || 0,
    products: productsRes.count || 0,
    searchesToday: 0,
    bookmarks: 0,
  };
}
