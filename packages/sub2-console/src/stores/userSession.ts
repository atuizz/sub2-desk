import { accessTokenMatchesSession } from '@/api/authTokenLineage';
import type { User } from '@/types';

interface ProfileStore { user: User | null; token: string | null; sessionRevision: number }
export interface UserSession { id: number; revision: number; token: string }

// Normal token renewal belongs to the same session; a new login never does.
export function captureUserSession(auth: ProfileStore): UserSession | null {
  return auth.user && auth.token && accessTokenMatchesSession(auth.user.id, auth.token)
    ? { id: auth.user.id, revision: auth.sessionRevision, token: auth.token } : null;
}
export function isUserSessionCurrent(auth: ProfileStore, session: UserSession | null): boolean {
  return !!session && auth.user?.id === session.id && auth.sessionRevision === session.revision &&
    accessTokenMatchesSession(session.id, session.token);
}
export function publishUserProfile(auth: ProfileStore, session: UserSession | null, profile: User): boolean {
  if (!isUserSessionCurrent(auth, session) || profile?.id !== session!.id) return false;
  auth.user = profile;
  return true;
}
