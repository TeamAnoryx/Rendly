/**
 * Group posting rule. In view-only mode only the creator, admins and the one member given
 * priority access may post; everyone may post otherwise. Pure, so it is unit tested.
 */
export function canPostInGroup(opts: {
  viewOnly: boolean;
  role: string | undefined;
  priorityUserId: string | null;
  userId: string;
}): boolean {
  if (!opts.viewOnly) return true;
  if (opts.role === "creator" || opts.role === "admin") return true;
  return opts.priorityUserId !== null && opts.priorityUserId === opts.userId;
}
