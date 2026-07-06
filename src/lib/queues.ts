// ponytail: Redis removed — queue calls are no-ops. Add a job queue when background processing is needed.
export type QueueName = "live-events" | "payment-events";

export async function enqueueLiveEvent(_name: string, _data: Record<string, unknown>) {
  return null;
}

export async function enqueuePaymentEvent(_name: string, _data: Record<string, unknown>) {
  return null;
}
