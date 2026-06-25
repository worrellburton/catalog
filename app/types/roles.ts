// 'super_admin' sits above 'admin' - used to gate destructive actions on
// public surfaces (e.g. deleting a product creative directly from the
// consumer feed). Admin pages remain reachable by both 'admin' and
// 'super_admin'; only super-admin-gated UI checks the stricter tier.
// brand_owner / brand_member are PLATFORM roles that mark a user as a brand
// partner. Actual brand access is the brand_members table; these roles are the
// "is a brand partner (set up a brand on first sign-in)" signal — see
// create_my_brand RPC + the onboarding step in partners/route.tsx.
export type UserRole = 'shopper' | 'creator' | 'admin' | 'super_admin' | 'brand_owner' | 'brand_member';

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  shopper: 'Shopper',
  creator: 'Creator',
  admin: 'Admin',
  super_admin: 'Super Admin',
  brand_owner: 'Brand owner',
  brand_member: 'Brand member',
};

export const DEFAULT_ROLE: UserRole = 'shopper';

/**
 * Roles permitted to reach the admin panel. Per the note above, BOTH `admin`
 * and `super_admin` have full admin-page access — `super_admin` only matters
 * for the stricter destructive-action gates on public surfaces. Centralised
 * here so every admin entry point gates on the same definition.
 */
export function isAdminRole(role: UserRole | null | undefined): boolean {
  return role === 'admin' || role === 'super_admin';
}
