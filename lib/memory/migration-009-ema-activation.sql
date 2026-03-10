ALTER TABLE agent_memory.fragments
  ADD COLUMN IF NOT EXISTS ema_activation    FLOAT    DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS ema_last_updated  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_fragments_ema_activation
  ON agent_memory.fragments (ema_activation DESC);
