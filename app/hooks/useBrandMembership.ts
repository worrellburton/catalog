import { useEffect, useState } from 'react';
import { useOutletContext } from '@remix-run/react';
import { supabase } from '~/utils/supabase';
import { useAuth } from '~/hooks/useAuth';
import { isAdminRole } from '~/types/roles';

// Brand portal membership resolution. The DB is the source of truth: RLS on
// brand_members (members_read = is_brand_member(brand_id) OR is_platform_admin)
// means this query only ever returns rows the signed-in user is allowed to see,
// so the gate is server-enforced — the client check is just for UX.

export type BrandRole = 'owner' | 'admin' | 'finance' | 'creative';

export interface PartnersBrand {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  shopify_shop: string | null;
  subscription_status: string | null;
}

export interface BrandMembership {
  brandId: string;
  role: BrandRole;
  brand: PartnersBrand;
}

interface MembershipState {
  loading: boolean;
  isPlatformAdmin: boolean;
  memberships: BrandMembership[];
}

export function useBrandMembership(): MembershipState & { userId: string | null } {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<MembershipState>({
    loading: true,
    isPlatformAdmin: false,
    memberships: [],
  });

  useEffect(() => {
    if (authLoading) return;
    if (!user?.id || !supabase) {
      setState({ loading: false, isPlatformAdmin: false, memberships: [] });
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('brand_members')
        .select('brand_id, role, brands ( id, slug, name, logo_url, shopify_shop, subscription_status )')
        .eq('user_id', user.id)
        .eq('status', 'active');
      if (cancelled) return;
      // supabase row typing for embedded joins is loose; matches the admin
      // panel's established `(r: any)` pattern for select-with-join rows.
      const memberships: BrandMembership[] = (data ?? [])
        .map((r: any) => ({ brandId: r.brand_id, role: r.role as BrandRole, brand: r.brands as PartnersBrand }))
        .filter((m: BrandMembership) => Boolean(m.brand));
      setState({ loading: false, isPlatformAdmin: isAdminRole(user.role), memberships });
    })();
    return () => { cancelled = true; };
  }, [user?.id, user?.role, authLoading]);

  return { ...state, userId: user?.id ?? null };
}

// Active-brand context handed down from the partners layout to every child
// route via <Outlet context={...} />. Children read it with usePartnersContext()
// instead of re-querying membership on every page.
export interface PartnersContext {
  brand: PartnersBrand;
  role: BrandRole;
  isPlatformAdmin: boolean;
  memberships: BrandMembership[];
}

export function usePartnersContext(): PartnersContext {
  return useOutletContext<PartnersContext>();
}
