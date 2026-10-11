-- Add dominant_color column to agents table.
-- Stores the raw dominant RGB color extracted from the agent's avatar image.
-- Format: "r, g, b" (e.g. "164, 120, 80")
ALTER TABLE agents ADD COLUMN IF NOT EXISTS dominant_color TEXT;
