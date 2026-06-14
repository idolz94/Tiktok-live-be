export function isUuid(value?: string | null) {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function createOrderCode() {
  const digits = Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0");
  return `LUMI-${digits}`;
}
