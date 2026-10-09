import type { StaffRole } from './enums';

// Same model as the ApexBook platform: every route declares a permission and the
// server enforces it. Add a role by giving it a permission set here.
export const PERMISSIONS = [
  'dashboard:read',
  'bookings:read',
  'bookings:write',
  'customers:read',
  'customers:write',
  'payments:read',
  'payments:write',
  'payments:refund',
  'rooms:write',
  'equipment:write',
  'hours:write',
  'settings:write',
  'website:write',
  'staff:manage',
  'system:read',
  'audit:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const STAFF: Permission[] = [
  'dashboard:read',
  'bookings:read',
  'bookings:write',
  'customers:read',
  'customers:write',
  'payments:read',
  'payments:write',
  'system:read',
];

export const ROLE_PERMISSIONS: Record<StaffRole, ReadonlySet<Permission>> = {
  ADMIN: new Set(PERMISSIONS),
  STAFF: new Set(STAFF),
};

export function permissionsList(role: StaffRole): Permission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

export function hasPermission(role: StaffRole, p: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(p) ?? false;
}
