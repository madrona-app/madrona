/**
 * Re-export useMfaChallenge hook from context for convenience.
 *
 * Usage:
 * ```tsx
 * import { useMfaChallenge } from '@/hooks/useMfaChallenge';
 *
 * function MyComponent() {
 *   const { withMfaChallenge } = useMfaChallenge();
 *
 *   const handleSensitiveAction = async () => {
 *     await withMfaChallenge(
 *       () => api.inviteUser(email, role),
 *       'Inviting a new user requires identity verification'
 *     );
 *   };
 * }
 * ```
 */
export { useMfaChallenge } from '../contexts/MfaChallengeContext';
