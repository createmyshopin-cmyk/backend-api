-- Repair: add rebuild_creator_analytics_daily (missing from minimal deploy),
-- sync wallet call_earnings_total from creator_earnings, backfill L4 read model.

BEGIN;

CREATE OR REPLACE FUNCTION public.rebuild_creator_analytics_daily(
  p_creator_profile_id UUID DEFAULT NULL,
  p_from_date          DATE DEFAULT NULL,
  p_to_date            DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted   BIGINT := 0;
  v_upserted  BIGINT := 0;
BEGIN
  DELETE FROM public.creator_analytics_daily cad
   WHERE (p_creator_profile_id IS NULL OR cad.creator_profile_id = p_creator_profile_id)
     AND (p_from_date IS NULL OR cad.date >= p_from_date)
     AND (p_to_date IS NULL OR cad.date <= p_to_date);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  WITH call_agg AS (
    SELECT
      cp.id AS creator_profile_id,
      public.creator_analytics_bucket_date(ce.created_at) AS bucket_date,
      COALESCE(SUM(ce.creator_share), 0)::NUMERIC(12, 2) AS call_coins,
      COUNT(*)::INTEGER AS call_count,
      COALESCE(SUM(
        COALESCE(c.billable_duration_seconds, c.duration_seconds, 0)
      ), 0)::INTEGER AS call_duration_seconds,
      MAX(ce.created_at) AS last_event_at
    FROM public.creator_earnings ce
    JOIN public.creator_profiles cp ON cp.user_id = ce.creator_id
    JOIN public.calls c ON c.id = ce.call_id
    WHERE (p_creator_profile_id IS NULL OR cp.id = p_creator_profile_id)
      AND (p_from_date IS NULL OR public.creator_analytics_bucket_date(ce.created_at) >= p_from_date)
      AND (p_to_date IS NULL OR public.creator_analytics_bucket_date(ce.created_at) <= p_to_date)
    GROUP BY cp.id, public.creator_analytics_bucket_date(ce.created_at)
  ),
  gift_agg AS (
    SELECT
      gt.creator_id AS creator_profile_id,
      public.creator_analytics_bucket_date(gt.created_at) AS bucket_date,
      COALESCE(SUM(gt.creator_coins), 0)::NUMERIC(12, 2) AS gift_coins,
      COUNT(*)::INTEGER AS gifts_received_count,
      MAX(gt.created_at) AS last_event_at
    FROM public.gift_transactions gt
    WHERE (p_creator_profile_id IS NULL OR gt.creator_id = p_creator_profile_id)
      AND (p_from_date IS NULL OR public.creator_analytics_bucket_date(gt.created_at) >= p_from_date)
      AND (p_to_date IS NULL OR public.creator_analytics_bucket_date(gt.created_at) <= p_to_date)
    GROUP BY gt.creator_id, public.creator_analytics_bucket_date(gt.created_at)
  ),
  combined AS (
    SELECT
      COALESCE(ca.creator_profile_id, ga.creator_profile_id) AS creator_profile_id,
      COALESCE(ca.bucket_date, ga.bucket_date) AS bucket_date,
      COALESCE(ca.call_coins, 0) AS call_coins,
      COALESCE(ga.gift_coins, 0) AS gift_coins,
      COALESCE(ca.call_count, 0) AS call_count,
      COALESCE(ca.call_duration_seconds, 0) AS call_duration_seconds,
      COALESCE(ga.gifts_received_count, 0) AS gifts_received_count,
      GREATEST(COALESCE(ca.last_event_at, '-infinity'::TIMESTAMPTZ),
               COALESCE(ga.last_event_at, '-infinity'::TIMESTAMPTZ)) AS last_event_at
    FROM call_agg ca
    FULL OUTER JOIN gift_agg ga
      ON ca.creator_profile_id = ga.creator_profile_id
     AND ca.bucket_date = ga.bucket_date
  ),
  upserted AS (
    INSERT INTO public.creator_analytics_daily (
      creator_profile_id, date,
      call_coins, gift_coins,
      call_count, call_duration_seconds, gifts_received_count,
      created_at, updated_at
    )
    SELECT
      creator_profile_id,
      bucket_date,
      call_coins,
      gift_coins,
      call_count,
      call_duration_seconds,
      gifts_received_count,
      CASE WHEN last_event_at = '-infinity'::TIMESTAMPTZ THEN NOW() ELSE last_event_at END,
      NOW()
    FROM combined
    RETURNING 1
  )
  SELECT COUNT(*)::BIGINT INTO v_upserted FROM upserted;

  RETURN jsonb_build_object(
    'creator_profile_id', p_creator_profile_id,
    'from_date', p_from_date,
    'to_date', p_to_date,
    'rows_deleted', v_deleted,
    'rows_upserted', v_upserted,
    'timezone', 'Asia/Kolkata'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rebuild_creator_analytics_daily(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rebuild_creator_analytics_daily(UUID, DATE, DATE) TO service_role;

-- Repair wallet call_earnings_total drift (pre-ledger gifts/calls path).
UPDATE public.creator_wallets cw
   SET call_earnings_total = sub.call_coins,
       total_earned = sub.call_coins + COALESCE(cw.gift_earnings_total, 0),
       updated_at = NOW()
  FROM (
    SELECT
      cp.id AS creator_profile_id,
      COALESCE(SUM(ce.creator_share), 0)::NUMERIC(12, 2) AS call_coins
    FROM public.creator_profiles cp
    LEFT JOIN public.creator_earnings ce ON ce.creator_id = cp.user_id
    GROUP BY cp.id
  ) sub
 WHERE cw.creator_id = sub.creator_profile_id
   AND (
     cw.call_earnings_total IS DISTINCT FROM sub.call_coins
     OR cw.total_earned IS DISTINCT FROM (sub.call_coins + COALESCE(cw.gift_earnings_total, 0))
   );

SELECT public.rebuild_creator_analytics_daily(NULL::UUID, NULL::DATE, NULL::DATE);

NOTIFY pgrst, 'reload schema';

COMMIT;
