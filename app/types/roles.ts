// 'super_admin' sits above 'admin' - used to gate destructive actions on
// public surfaces (e.g. deleting a product creative directly from the
// consumer feed). Admin pages remain reachable by both 'admin' and
// 'super_admin'; only super-admin-gated UI checks the stricter tier.
export type UserRole = 'shopper' | 'creator' | 'admin' | 'super_admin';

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  shopper: 'Shopper',
  creator: 'Creator',
  admin: 'Admin',
  super_admin: 'Super Admin',
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
