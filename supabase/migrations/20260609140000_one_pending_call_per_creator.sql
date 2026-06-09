-- One ringing call request per creator at a time (prevents duplicate incoming calls).
-- Clean up any existing duplicate pending rows first (keep oldest per creator).

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY creator_id
      ORDER BY created_at ASC
    ) AS rn
  FROM public.call_requests
  WHERE status IN ('requested', 'pending')
    AND call_id IS NULL
)
UPDATE public.call_requests cr
SET status = 'cancelled',
    updated_at = NOW()
FROM ranked r
WHERE cr.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_call_requests_one_pending_per_creator
  ON public.call_requests (creator_id)
  WHERE status IN ('requested', 'pending') AND call_id IS NULL;
