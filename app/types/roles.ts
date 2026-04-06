export type UserRole = 'shopper' | 'creator' | 'admin';

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  shopper: 'Shopper',
  creator: 'Creator',
  admin: 'Admin',
};

export const DEFAULT_ROLE: UserRole = 'shopper';
