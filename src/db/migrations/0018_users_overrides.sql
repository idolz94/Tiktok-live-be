-- Per-user overrides (device limit / feature flags) without changing the plan.
-- Shape: { maxDevices?: { value, setBy, setByUsername, setAt }, features?: { <key>: { value, setBy, setByUsername, setAt } } }
ALTER TABLE users ADD COLUMN IF NOT EXISTS overrides jsonb;
