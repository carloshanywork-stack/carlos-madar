import { positiveId } from './http.js';

/** Business routes are mounted behind authentication; never attribute work to a bootstrap user. */
export function requestActorId(req) {
  if (req.user?.id !== undefined && req.user?.id !== null) return positiveId(req.user.id, 'actorId');
  return null;
}
