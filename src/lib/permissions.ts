/** Capabilities are always read from the current DB user, never trusted from JWT/request. */
import type { JwtPayload } from '../types';
export const STAFF_PERMISSIONS = {
  'customer.create': 'ثبت مشتری جدید',
  'customer.search': 'جستجوی لقب، نام و بخشی از شماره',
  'customer.list': 'مشاهدهٔ فهرست مشتریان (فقط خواندنی)',
  'invoice.create': 'ثبت فاکتور و یافتن مشتری با شمارهٔ کامل',
  'invoice.history': 'مشاهدهٔ فاکتورهای خود',
  'shift.manage': 'مدیریت صندوق خود',
} as const;
export type StaffPermission = keyof typeof STAFF_PERMISSIONS;
// Old staff had invoicing/history/shifts, but no customer directory/creation.
export const LEGACY_STAFF_PERMISSIONS: StaffPermission[] = ['invoice.create','invoice.history','shift.manage'];
export const NEW_STAFF_PERMISSIONS: StaffPermission[] = ['customer.create', ...LEGACY_STAFF_PERMISSIONS];
export function validatePermissions(value: unknown): value is StaffPermission[] {
  return Array.isArray(value) && value.length <= Object.keys(STAFF_PERMISSIONS).length &&
    value.every(p => typeof p === 'string' && Object.prototype.hasOwnProperty.call(STAFF_PERMISSIONS,p)) && new Set(value).size === value.length;
}
export function storedPermissions(value: string | null | undefined): StaffPermission[] {
  if (value == null) return [...LEGACY_STAFF_PERMISSIONS];
  try { const parsed: unknown = JSON.parse(value); return validatePermissions(parsed) ? parsed : []; } catch { return []; }
}
export function can(user: Pick<JwtPayload,'role'|'permissions'> | null | undefined, permission: StaffPermission): boolean {
  return user?.role === 'admin' || (user?.role === 'staff' && !!user.permissions?.includes(permission));
}

/** Personnel portal identity; never elevate a customer OTP session. */
export function personnelRole(user: {role: string; staff_role?: string | null} | null | undefined): 'staff' | 'admin' | null {
  if(user?.role === 'admin' || user?.role === 'staff') return user.role;
  return user?.role === 'customer' && (user.staff_role === 'staff' || user.staff_role === 'admin') ? user.staff_role : null;
}
