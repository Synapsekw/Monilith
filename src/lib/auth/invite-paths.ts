/**
 * The invited person's path, in one place so the email template test, the
 * confirm route and the delivery helper cannot drift. Pure (no `next/*`).
 */

/** Where the link in the invite email lands (`src/app/auth/confirm`). */
export const INVITE_CONFIRM_PATH = "/auth/confirm";

/**
 * Where an invited person sets their first password. `invite=1` selects the
 * invitee wording on the existing change-password screen.
 */
export const INVITE_SET_PASSWORD_PATH = "/change-password?invite=1";
