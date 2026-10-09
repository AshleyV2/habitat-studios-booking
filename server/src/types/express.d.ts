import type { Permission, StaffRole } from '@habitat/shared';

export interface AuthContext {
  sessionId: string;
  user: { id: string; email: string; name: string; role: StaffRole };
  permissions: ReadonlySet<Permission>;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}
