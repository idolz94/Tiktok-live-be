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
}: {
  username: string;
  shopId?: string;
}) {
  return stopTikTokCollector({ username });
}

export function getPythonCollectors() {
  return listTikTokCollectors();
}
