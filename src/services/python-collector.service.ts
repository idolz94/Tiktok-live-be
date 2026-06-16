import {
  listTikTokCollectors,
  startTikTokCollector,
  stopTikTokCollector,
} from "./tiktok-collector.service.js";

export async function startPythonCollector({
  username,
  shopId,
  liveSessionId,
}: {
  username: string;
  shopId: string;
  liveSessionId?: string | null;
}) {
  return startTikTokCollector({ username, shopId, liveSessionId });
}

export async function stopPythonCollector({
  username,
  silent,
}: {
  username: string;
  shopId?: string;
  silent?: boolean;
}) {
  return stopTikTokCollector({ username, silent });
}

export function getPythonCollectors() {
  return listTikTokCollectors();
}
