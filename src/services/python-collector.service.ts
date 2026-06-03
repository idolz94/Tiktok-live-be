import { env } from "../config/env.js";

async function callPythonCollector(path: string, body: Record<string, unknown>) {
  if (!env.pythonCollectorBaseUrl) {
    return {
      ok: false,
      skipped: true,
      message: "PYTHON_COLLECTOR_BASE_URL chưa được cấu hình.",
    };
  }

  const url = `${env.pythonCollectorBaseUrl.replace(/\/$/, "")}${path}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-collector-api-key": env.collectorControlApiKey,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let data: any = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }

  if (!response.ok) {
    throw new Error(data?.message || `Python collector error ${response.status}`);
  }

  return data;
}

export function startPythonCollector({
  username,
  shopId,
  liveSessionId,
}: {
  username: string;
  shopId: string;
  liveSessionId?: string | null;
}) {
  return callPythonCollector("/collectors/start", {
    username,
    shopId,
    liveSessionId: liveSessionId || undefined,
  });
}

export function stopPythonCollector({ username }: { username: string; shopId?: string }) {
  return callPythonCollector("/collectors/stop", { username });
}
