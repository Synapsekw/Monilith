/** True if a (possibly unknown) actions payload contains a call_webhook action. */
export function actionsContainWebhook(actions: unknown): boolean {
  return (
    Array.isArray(actions) &&
    actions.some(
      (a) =>
        typeof a === "object" &&
        a !== null &&
        (a as { type?: string }).type === "call_webhook",
    )
  );
}
