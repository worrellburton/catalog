import { supabase } from '~/utils/supabase';

// ============================================
// Types
// ============================================

export type LookStatus = 'draft' | 'submitted' | 'in_review' | 'live' | 'denied' | 'archived';

export interface LookPhoto {
  id: string;
  order_index: number;
  storage_path: string;
  url: string | null;
  thumbnail_url: string | null;
  transform: Record<string, unknown> | null;
}

export interface LookVideo {
  id: string;
  order_index: number;
  storage_path: string;
  url: string | null;
  poster_url: string | null;
  duration_seconds: number | null;
}

export interface LookProduct {
  sort_order: number;
  products: {
    id: string;
    name: string;
    brand: string | null;
    price: string | null;
    url: string | null;
    image_url: string | null;
  };
}

export interface ManagedLook {
  id: string;
  title: string;
  description: string | null;
  gender: 'men' | 'women' | 'unisex' | null;
  color: string | null;
  status: LookStatus;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  look_photos: LookPhoto[];
  look_videos: LookVideo[];
  look_products: LookProduct[];
}

export interface CreateLookInput {
  title: string;
  description?: string;
  gender?: 'men' | 'women' | 'unisex';
  color?: string;
}

export interface UpdateLookInput {
  title?: string;
  description?: string;
  gender?: 'men' | 'women' | 'unisex';
  color?: string;
  status?: LookStatus;
}

export interface AddProductInput {
  product_id?: string;
  name?: string;
  brand?: string;
  price?: string;
  url?: string;
  image_url?: string;
}

interface PaginatedResponse<T> {
  success: boolean;
  data: T;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ============================================
// API helpers — edge function for writes only
// ============================================

function getEdgeFunctionUrl(path: string): string {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL || '';
  return `${baseUrl}/functions/v1/manage-looks${path}`;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return {
    'Authorization': `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
    'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  };
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(getEdgeFunctionUrl(path), {
    ...options,
    headers: { ...headers, ...options.headers },
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error || `Request failed: ${res.status}`);
  }
  return json as T;
}

async function getCurrentUserId(): Promise<string> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) throw new Error('Not authenticated');
  return session.user.id;
}

// ============================================
// Look CRUD — reads use direct Supabase, writes use edge function
// ============================================

export async function getMyLooks(params?: { status?: LookStatus; page?: number; limit?: number }): Promise<PaginatedResponse<ManagedLook[]>> {
  if (!supabase) throw new Error('Supabase not configured');
  const userId = await getCurrentUserId();

  const page = params?.page || 1;
  const limit = params?.limit || 12;
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  // Build query
  let query = supabase
    .from('looks')
    .select(`
      *,
      look_photos ( id, order_index, storage_path, url, thumbnail_url, transform ),
      look_videos ( id, order_index, storage_path, url, poster_url, duration_seconds ),
      look_products ( sort_order, products:products ( id, name, brand, price, url, image_url ) )
    `, { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (params?.status) {
    query = query.eq('status', params.status);
  }

  const { data, error, count } = await query;

  if (error) throw new Error(error.message);

  const total = count || 0;
  const looks: ManagedLook[] = (data || []).map((row: Record<string, unknown>) => ({
    ...row,
    look_photos: (row.look_photos as LookPhoto[]) || [],
    look_videos: (row.look_videos as LookVideo[]) || [],
    look_products: (row.look_products as LookProduct[]) || [],
  })) as ManagedLook[];

  return {
    success: true,
    data: looks,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getLookDetail(lookId: string): Promise<{ success: boolean; data: ManagedLook }> {
  if (!supabase) throw new Error('Supabase not configured');
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('looks')
    .select(`
      *,
      look_photos ( id, order_index, storage_path, url, thumbnail_url, transform ),
      look_videos ( id, order_index, storage_path, url, poster_url, duration_seconds ),
      look_products ( sort_order, products:products ( id, name, brand, price, url, image_url ) )
    `)
    .eq('id', lookId)
    .eq('user_id', userId)
    .single();

  if (error || !data) throw new Error(error?.message || 'Not found');

  return {
    success: true,
    data: {
      ...data,
      look_photos: data.look_photos || [],
      look_videos: data.look_videos || [],
      look_products: data.look_products || [],
    } as ManagedLook,
  };
}

export async function createLook(input: CreateLookInput): Promise<{ success: boolean; data: ManagedLook }> {
  return apiFetch('', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateLook(lookId: string, input: UpdateLookInput): Promise<{ success: boolean; data: ManagedLook }> {
  return apiFetch(`/${lookId}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export async function deleteLook(lookId: string): Promise<{ success: boolean }> {
  return apiFetch(`/${lookId}`, { method: 'DELETE' });
}

export async function submitLook(lookId: string): Promise<{ success: boolean; data: ManagedLook }> {
  return apiFetch(`/${lookId}/submit`, { method: 'POST' });
}

export async function archiveLook(lookId: string): Promise<{ success: boolean; data: ManagedLook }> {
  return apiFetch(`/${lookId}/archive`, { method: 'POST' });
}

// ============================================
// Products
// ============================================

export async function addProductToLook(lookId: string, input: AddProductInput): Promise<{ success: boolean; data: { product_id: string } }> {
  return apiFetch(`/${lookId}/products`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function removeProductFromLook(lookId: string, productId: string): Promise<{ success: boolean }> {
  return apiFetch(`/${lookId}/products/${productId}`, { method: 'DELETE' });
}

// ============================================
// Media Upload (direct to Supabase Storage)
// ============================================

export async function uploadLookMedia(
  lookId: string,
  file: File,
  type: 'photo' | 'video'
): Promise<{ storagePath: string; publicUrl: string }> {
  if (!supabase) throw new Error('Supabase not configured');

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) throw new Error('Not authenticated');

  const userId = session.user.id;
  const ext = file.name.split('.').pop() || (type === 'photo' ? 'jpg' : 'mp4');
  const fileName = `${crypto.randomUUID()}.${ext}`;
  const storagePath = `${userId}/${lookId}/${type}s/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from('look-media')
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  const { data: urlData } = supabase.storage
    .from('look-media')
    .getPublicUrl(storagePath);

  const publicUrl = urlData.publicUrl;

  // Record in DB
  const table = type === 'photo' ? 'look_photos' : 'look_videos';

  // Get next order index
  const { data: existing } = await supabase
    .from(table)
    .select('order_index')
    .eq('look_id', lookId)
    .is('deleted_at', null)
    .order('order_index', { ascending: false })
    .limit(1);

  const nextIndex = existing && existing.length > 0 ? (existing[0].order_index || 0) + 1 : 0;

  const record: Record<string, unknown> = {
    look_id: lookId,
    storage_path: storagePath,
    order_index: nextIndex,
  };

  if (type === 'photo') {
    record.url = publicUrl;
    record.thumbnail_url = publicUrl;
  } else {
    record.url = publicUrl;
    record.poster_url = publicUrl; // can be updated later with actual poster
  }

  const { error: dbError } = await supabase.from(table).insert(record);
  if (dbError) throw new Error(`Failed to save media record: ${dbError.message}`);

  return { storagePath, publicUrl };
}

export async function deleteMedia(lookId: string, mediaType: 'photo' | 'video', mediaId: string): Promise<void> {
  await apiFetch(`/${lookId}/media/${mediaType}/${mediaId}`, { method: 'DELETE' });
}

// ============================================
// Search existing products
// ============================================

export async function searchProducts(query: string): Promise<{ id: string; name: string; brand: string | null; price: string | null; url: string | null; image_url: string | null }[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('products')
    .select('id, name, brand, price, url, image_url')
    .ilike('name', `%${query}%`)
    .limit(10);
  if (error) return [];
  return data || [];
}
