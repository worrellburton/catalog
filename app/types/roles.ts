// 'super_admin' sits above 'admin' — used to gate destructive actions on
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
