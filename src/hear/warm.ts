/**
 * Optional warm Hear socket between utterances (skip handshake on next PTT).
 * ponytail: one cached socket; ceiling = single concurrent Hear session.
 */
import { HearClient, type HearHandlers } from "./client";

let warm: HearClient | null = null;
let warmKey: string | null = null;
let parkTimer: ReturnType<typeof setTimeout> | null = null;

export async function acquireHear(
  apiKey: string,
  handlers: HearHandlers,
): Promise<HearClient> {
  if (parkTimer) {
    clearTimeout(parkTimer);
    parkTimer = null;
  }
  if (warm?.ready && warmKey === apiKey) {
    warm.setHandlers(handlers);
    warm.beginUtterance();
    return warm;
  }
  warm?.close();
  warm = null;
  const client = new HearClient(handlers);
  await client.connect(apiKey);
  warm = client;
  warmKey = apiKey;
  return client;
}

/** Keep socket for a short idle window; do not send audio while parked. */
export function parkHear(client: HearClient | null): void {
  if (!client?.ready) {
    client?.close();
    if (warm === client) {
      warm = null;
      warmKey = null;
    }
    return;
  }
  warm = client;
  if (parkTimer) clearTimeout(parkTimer);
  parkTimer = setTimeout(() => {
    if (warm === client) {
      warm.close();
      warm = null;
      warmKey = null;
    }
    parkTimer = null;
  }, 45_000);
}
