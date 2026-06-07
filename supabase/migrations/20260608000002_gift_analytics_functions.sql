-- ============================================================
-- Migration: Gift analytics SQL helpers for admin dashboard
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.gift_analytics_summary()
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  WITH bounds AS (
    SELECT
      date_trunc('day', NOW())   AS day_start,
      date_trunc('week', NOW())  AS week_start,
      date_trunc('month', NOW()) AS month_start
  ),
  agg AS (
    SELECT
      COALESCE(SUM(gt.coins_spent), 0)::BIGINT AS lifetime_revenue,
      COALESCE(SUM(gt.platform_coins), 0)::BIGINT AS lifetime_platform,
      COALESCE(SUM(gt.creator_coins), 0)::BIGINT AS lifetime_creator,
      COUNT(*)::BIGINT AS gift_count
    FROM public.gift_transactions gt
  ),
  today AS (
    SELECT
      COALESCE(SUM(gt.coins_spent), 0)::BIGINT AS revenue,
      COALESCE(SUM(gt.platform_coins), 0)::BIGINT AS platform,
      COALESCE(SUM(gt.creator_coins), 0)::BIGINT AS creator
    FROM public.gift_transactions gt, bounds b
    WHERE gt.created_at >= b.day_start
  ),
  week AS (
    SELECT
      COALESCE(SUM(gt.coins_spent), 0)::BIGINT AS revenue,
      COALESCE(SUM(gt.platform_coins), 0)::BIGINT AS platform,
      COALESCE(SUM(gt.creator_coins), 0)::BIGINT AS creator
    FROM public.gift_transactions gt, bounds b
    WHERE gt.created_at >= b.week_start
  ),
  month AS (
    SELECT
      COALESCE(SUM(gt.coins_spent), 0)::BIGINT AS revenue,
      COALESCE(SUM(gt.platform_coins), 0)::BIGINT AS platform,
      COALESCE(SUM(gt.creator_coins), 0)::BIGINT AS creator
    FROM public.gift_transactions gt, bounds b
    WHERE gt.created_at >= b.month_start
  ),
  top_gifts AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'giftId', g.id,
          'name', g.name,
          'count', t.cnt,
          'revenue', t.revenue
        )
        ORDER BY t.cnt DESC
      ),
      '[]'::jsonb
    ) AS items
    FROM (
      SELECT gift_id, COUNT(*) AS cnt, SUM(coins_spent) AS revenue
      FROM public.gift_transactions
      GROUP BY gift_id
      ORDER BY cnt DESC
      LIMIT 10
    ) t
    JOIN public.gifts g ON g.id = t.gift_id
  ),
  top_senders AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'userId', u.id,
          'name', COALESCE(u.full_name, u.name, 'User'),
          'count', s.cnt,
          'coinsSpent', s.spent
        )
        ORDER BY s.spent DESC
      ),
      '[]'::jsonb
    ) AS items
    FROM (
      SELECT sender_user_id, COUNT(*) AS cnt, SUM(coins_spent) AS spent
      FROM public.gift_transactions
      GROUP BY sender_user_id
      ORDER BY spent DESC
      LIMIT 10
    ) s
    JOIN public.users u ON u.id = s.sender_user_id
  ),
  top_creators AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'creatorProfileId', cp.id,
          'creatorUserId', cp.user_id,
          'count', c.cnt,
          'earnings', c.earned
        )
        ORDER BY c.earned DESC
      ),
      '[]'::jsonb
    ) AS items
    FROM (
      SELECT creator_id, COUNT(*) AS cnt, SUM(creator_coins) AS earned
      FROM public.gift_transactions
      GROUP BY creator_id
      ORDER BY earned DESC
      LIMIT 10
    ) c
    JOIN public.creator_profiles cp ON cp.id = c.creator_id
  )
  SELECT jsonb_build_object(
    'todayRevenue', (SELECT revenue FROM today),
    'weekRevenue', (SELECT revenue FROM week),
    'monthRevenue', (SELECT revenue FROM month),
    'lifetimeRevenue', (SELECT lifetime_revenue FROM agg),
    'giftCount', (SELECT gift_count FROM agg),
    'platformRevenue', jsonb_build_object(
      'today', (SELECT platform FROM today),
      'week', (SELECT platform FROM week),
      'month', (SELECT platform FROM month),
      'lifetime', (SELECT lifetime_platform FROM agg)
    ),
    'creatorEarnings', jsonb_build_object(
      'today', (SELECT creator FROM today),
      'week', (SELECT creator FROM week),
      'month', (SELECT creator FROM month),
      'lifetime', (SELECT lifetime_creator FROM agg)
    ),
    'topGifts', (SELECT items FROM top_gifts),
    'topSenders', (SELECT items FROM top_senders),
    'topReceivingCreators', (SELECT items FROM top_creators)
  );
$$;

COMMIT;
