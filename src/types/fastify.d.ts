import 'fastify';

export type CurrentUser = {
  id: string;
  email: string;
  role: 'buyer' | 'org_member' | 'org_admin' | 'platform_admin';
  emailVerifiedAt: string | null;
};

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: CurrentUser | null;
    sessionId: string | null;
    csrfToken: string | null;
    sessionData: Record<string, unknown>;
  }
}
