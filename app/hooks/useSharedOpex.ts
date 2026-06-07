import { type OpexItem, OPEX_STORAGE_KEY, defaultOpexItems } from '~/services/opex';
import { type PayrollItem, PAYROLL_STORAGE_KEY, defaultPayrollItems } from '~/services/opex';
import { type SharedList, useSharedList } from '~/hooks/useSharedList';

// Shared, real-time OpEx line items + payroll — each is one app_settings
// row, broadcast live across admin sessions.

export function useSharedOpex(): SharedList<OpexItem> {
  return useSharedList<OpexItem>('model:opex:v1', OPEX_STORAGE_KEY, defaultOpexItems);
}

export function useSharedPayroll(): SharedList<PayrollItem> {
  return useSharedList<PayrollItem>('model:payroll:v1', PAYROLL_STORAGE_KEY, defaultPayrollItems);
}
