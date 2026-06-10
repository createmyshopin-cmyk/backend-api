-- ============================================================
-- Sprint 7: Reconciliation Engine T0–T8
-- reconciliation_findings · wallet_freeze_flags · reconciliation_run
-- ============================================================

BEGIN;

-- ── reconciliation_runs ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reconciliation_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier            TEXT NOT NULL CHECK (tier IN ('T0','T1','T2','T3','T4','T5','T6','T7','T8')),
  status          TEXT NOT NULL CHECK (status IN ('running','completed','failed','skipped')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  duration_ms     INTEGER,
  checks_executed INTEGER NOT NULL DEFAULT 0,
  findings_new    INTEGER NOT NULL DEFAULT 0,
  findings_open   INTEGER NOT NULL DEFAULT 0,
  summary_json    JSONB NOT NULL DEFAULT '{}'::JSONB,
  error_message   TEXT,
  hostname        TEXT
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_runs_tier_started
  ON public.reconciliation_runs (tier, started_at DESC);

-- ── reconciliation_findings ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reconciliation_findings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID NOT NULL REFERENCES public.reconciliation_runs(id) ON DELETE CASCADE,
  check_id          TEXT NOT NULL,
  tier              TEXT NOT NULL,
  severity          TEXT NOT NULL CHECK (severity IN ('INFO','WARN','P1','P0')),
  status            TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','acknowledged','resolved','false_positive')),
  fingerprint       TEXT NOT NULL,
  entity_type       TEXT,
  entity_id         UUID,
  delta_amount      NUMERIC,
  delta_coins       INTEGER,
  evidence_json     JSONB NOT NULL DEFAULT '{}'::JSONB,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ,
  resolved_by       UUID,
  resolution_notes  TEXT,
  CONSTRAINT uq_reconciliation_findings_fingerprint UNIQUE (check_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_findings_status_severity
  ON public.reconciliation_findings (status, severity, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_reconciliation_findings_entity
  ON public.reconciliation_findings (entity_type, entity_id)
  WHERE status = 'open';

-- ── wallet_freeze_flags ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wallet_freeze_flags (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('user','creator','system')),
  entity_id       UUID,
  frozen          BOOLEAN NOT NULL DEFAULT TRUE,
  reason          TEXT NOT NULL,
  finding_id      UUID REFERENCES public.reconciliation_findings(id),
  frozen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unfrozen_at     TIMESTAMPTZ,
  unfrozen_by     UUID
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_freeze_active
  ON public.wallet_freeze_flags (entity_type, COALESCE(entity_id::TEXT, 'system'))
  WHERE frozen = TRUE AND unfrozen_at IS NULL;

ALTER TABLE public.reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_freeze_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reconciliation_runs_deny ON public.reconciliation_runs;
CREATE POLICY reconciliation_runs_deny ON public.reconciliation_runs
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS reconciliation_findings_deny ON public.reconciliation_findings;
CREATE POLICY reconciliation_findings_deny ON public.reconciliation_findings
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS wallet_freeze_flags_deny ON public.wallet_freeze_flags;
CREATE POLICY wallet_freeze_flags_deny ON public.wallet_freeze_flags
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ── upsert finding helper ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public._reconciliation_upsert_finding(
  p_run_id       UUID,
  p_tier         TEXT,
  p_check_id     TEXT,
  p_severity     TEXT,
  p_fingerprint  TEXT,
  p_entity_type  TEXT DEFAULT NULL,
  p_entity_id    UUID DEFAULT NULL,
  p_delta_amount NUMERIC DEFAULT NULL,
  p_delta_coins  INTEGER DEFAULT NULL,
  p_evidence     JSONB DEFAULT '{}'::JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_is_new BOOLEAN := FALSE;
BEGIN
  INSERT INTO public.reconciliation_findings (
    run_id, check_id, tier, severity, fingerprint,
    entity_type, entity_id, delta_amount, delta_coins, evidence_json
  ) VALUES (
    p_run_id, p_check_id, p_tier, p_severity, p_fingerprint,
    p_entity_type, p_entity_id, p_delta_amount, p_delta_coins, p_evidence
  )
  ON CONFLICT (check_id, fingerprint) DO UPDATE
    SET last_seen_at = NOW(),
        run_id = EXCLUDED.run_id,
        tier = EXCLUDED.tier,
        severity = EXCLUDED.severity,
        delta_amount = COALESCE(EXCLUDED.delta_amount, reconciliation_findings.delta_amount),
        delta_coins = COALESCE(EXCLUDED.delta_coins, reconciliation_findings.delta_coins),
        evidence_json = reconciliation_findings.evidence_json || EXCLUDED.evidence_json
  WHERE reconciliation_findings.status = 'open';

  GET DIAGNOSTICS v_is_new = ROW_COUNT;
  RETURN v_is_new;
END;
$$;

-- ── P0 auto-freeze ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._reconciliation_auto_freeze_p0(
  p_finding_id   UUID,
  p_entity_type  TEXT,
  p_entity_id    UUID,
  p_reason       TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.wallet_freeze_flags
     WHERE entity_type = p_entity_type
       AND entity_id IS NOT DISTINCT FROM p_entity_id
       AND frozen = TRUE
       AND unfrozen_at IS NULL
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.wallet_freeze_flags (entity_type, entity_id, frozen, reason, finding_id)
  VALUES (p_entity_type, p_entity_id, TRUE, p_reason, p_finding_id);
END;
$$;

-- ── T0: infrastructure / schema readiness ─────────────────────
CREATE OR REPLACE FUNCTION public.reconciliation_execute_t0(p_run_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_missing TEXT[];
BEGIN
  SELECT ARRAY_AGG(t) INTO v_missing
    FROM (VALUES
      ('wallets'), ('coin_transactions'), ('payments'), ('withdrawals'),
      ('creator_wallets'), ('creator_ledger_entries'), ('calls')
    ) AS required(t)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = required.t
   );

  IF v_missing IS NOT NULL AND array_length(v_missing, 1) > 0 THEN
    PERFORM public._reconciliation_upsert_finding(
      p_run_id, 'T0', 'T0-SCHEMA-01', 'P0',
      'T0-SCHEMA-01:missing_tables',
      'system', NULL, NULL, NULL,
      jsonb_build_object('missing_tables', v_missing)
    );
    v_count := v_count + 1;
  ELSE
    PERFORM public._reconciliation_upsert_finding(
      p_run_id, 'T0', 'T0-SCHEMA-01', 'INFO',
      'T0-SCHEMA-01:ok', 'system', NULL
    );
    v_count := v_count + 1;
  END IF;

  RETURN v_count;
END;
$$;

-- ── T1: negative balances ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reconciliation_execute_t1(p_run_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  r RECORD;
  v_finding_id UUID;
BEGIN
  FOR r IN SELECT user_id, coin_balance FROM public.wallets WHERE coin_balance < 0
  LOOP
    PERFORM public._reconciliation_upsert_finding(
      p_run_id, 'T1', 'N-U-01', 'P0', 'N-U-01:' || r.user_id::TEXT,
      'user', r.user_id, NULL, r.coin_balance,
      jsonb_build_object('coin_balance', r.coin_balance)
    );
    v_count := v_count + 1;
  END LOOP;

  FOR r IN SELECT id, coins FROM public.users WHERE coins < 0
  LOOP
    PERFORM public._reconciliation_upsert_finding(
      p_run_id, 'T1', 'N-U-02', 'P0', 'N-U-02:' || r.id::TEXT,
      'user', r.id, NULL, r.coins,
      jsonb_build_object('users_coins', r.coins)
    );
    v_count := v_count + 1;
  END LOOP;

  FOR r IN
    SELECT creator_id, available_balance, total_earned
      FROM public.creator_wallets
     WHERE available_balance < 0 OR total_earned < 0 OR locked_balance < 0
  LOOP
    PERFORM public._reconciliation_upsert_finding(
      p_run_id, 'T1', 'N-C-01', 'P0', 'N-C-01:' || r.creator_id::TEXT,
      'creator', r.creator_id, r.available_balance, NULL,
      jsonb_build_object('available_balance', r.available_balance, 'total_earned', r.total_earned)
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ── T2: user wallet drift ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reconciliation_execute_t2(p_run_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT w.user_id, w.coin_balance AS projection, ct.balance_after AS ledger_tail,
           w.coin_balance - ct.balance_after AS delta
      FROM public.wallets w
      JOIN LATERAL (
        SELECT balance_after FROM public.coin_transactions
         WHERE user_id = w.user_id
         ORDER BY created_at DESC, id DESC LIMIT 1
      ) ct ON TRUE
     WHERE w.coin_balance IS DISTINCT FROM ct.balance_after
  LOOP
    PERFORM public._reconciliation_upsert_finding(
      p_run_id, 'T2', 'U-DRIFT-01', 'P1', 'U-DRIFT-01:' || r.user_id::TEXT,
      'user', r.user_id, r.delta, r.delta::INTEGER,
      jsonb_build_object('projection', r.projection, 'ledger_tail', r.ledger_tail)
    );
    v_count := v_count + 1;
  END LOOP;

  FOR r IN
    SELECT u.id, u.coins, w.coin_balance, u.coins - w.coin_balance AS delta
      FROM public.users u
      JOIN public.wallets w ON w.user_id = u.id
     WHERE u.coins IS DISTINCT FROM w.coin_balance
  LOOP
    PERFORM public._reconciliation_upsert_finding(
      p_run_id, 'T2', 'U-DRIFT-02', 'P1', 'U-DRIFT-02:' || r.id::TEXT,
      'user', r.id, r.delta, r.delta::INTEGER,
      jsonb_build_object('users_coins', r.coins, 'wallet_balance', r.coin_balance)
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ── T3: payment drift ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reconciliation_execute_t3(p_run_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.id AS payment_id, p.user_id, p.coins_added
      FROM public.payments p
     WHERE p.status = 'success'
       AND NOT EXISTS (
         SELECT 1 FROM public.coin_transactions ct
          WHERE ct.type = 'recharge' AND ct.reference_id::text = p.id::text
       )
  LOOP
    PERFORM public._reconciliation_upsert_finding(
      p_run_id, 'T3', 'M-U-01', 'P0', 'M-U-01:' || r.payment_id::TEXT,
      'payment', r.payment_id, NULL, r.coins_added,
      jsonb_build_object('user_id', r.user_id)
    );
    v_count := v_count + 1;
  END LOOP;

  FOR r IN
    SELECT payment_reference, COUNT(*) AS cnt
      FROM public.withdrawals
     WHERE status = 'paid' AND payment_reference IS NOT NULL
     GROUP BY payment_reference
    HAVING COUNT(*) > 1
  LOOP
    PERFORM public._reconciliation_upsert_finding(
      p_run_id, 'T3', 'D-P-02', 'P0', 'D-P-02:' || r.payment_reference,
      'system', NULL, NULL, NULL,
      jsonb_build_object('paid_count', r.cnt, 'payment_reference', r.payment_reference)
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ── T4: withdrawal drift / lock leaks ─────────────────────────
CREATE OR REPLACE FUNCTION public.reconciliation_execute_t4(p_run_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT creator_id,
           available_balance, locked_balance, withdrawn_amount, total_earned,
           (available_balance + locked_balance + withdrawn_amount) - total_earned AS delta
      FROM public.creator_wallets
     WHERE (available_balance + locked_balance + withdrawn_amount)
           IS DISTINCT FROM total_earned
  LOOP
    PERFORM public._reconciliation_upsert_finding(
      p_run_id, 'T4', 'C-DRIFT-01', 'P1', 'C-DRIFT-01:' || r.creator_id::TEXT,
      'creator', r.creator_id, r.delta, NULL,
      jsonb_build_object('wallet', row_to_json(r))
    );
    v_count := v_count + 1;
  END LOOP;

  FOR r IN
    SELECT cw.creator_id, cw.locked_balance,
           COALESCE(SUM(w.amount), 0) AS inflight_sum,
           cw.locked_balance - COALESCE(SUM(w.amount), 0) AS lock_delta
      FROM public.creator_wallets cw
      LEFT JOIN public.withdrawals w
        ON w.creator_profile_id = cw.creator_id
       AND w.status IN ('pending', 'approved')
     GROUP BY cw.creator_id, cw.locked_balance
    HAVING cw.locked_balance IS DISTINCT FROM COALESCE(SUM(w.amount), 0)
  LOOP
    PERFORM public._reconciliation_upsert_finding(
      p_run_id, 'T4', 'N-W-LOCK', 'P1', 'N-W-LOCK:' || r.creator_id::TEXT,
      'creator', r.creator_id, r.lock_delta, NULL,
      jsonb_build_object('locked_balance', r.locked_balance, 'inflight_sum', r.inflight_sum)
    );
    v_count := v_count + 1;
  END LOOP;

  FOR r IN
    SELECT creator_profile_id, COUNT(*) AS cnt
      FROM public.withdrawals
     WHERE status IN ('pending', 'approved') AND creator_profile_id IS NOT NULL
     GROUP BY creator_profile_id
    HAVING COUNT(*) > 1
  LOOP
    PERFORM public._reconciliation_upsert_finding(
      p_run_id, 'T4', 'D-P-04', 'P0', 'D-P-04:' || r.creator_profile_id::TEXT,
      'creator', r.creator_profile_id, NULL, NULL,
      jsonb_build_object('inflight_count', r.cnt)
    );
    v_count := v_count + 1;
  END LOOP;

  FOR r IN
    SELECT source_id AS withdrawal_id, COUNT(*) AS cnt
      FROM public.creator_ledger_entries
     WHERE entry_type = 'withdrawal_payout' AND source_id IS NOT NULL
     GROUP BY source_id
    HAVING COUNT(*) > 1
  LOOP
    PERFORM public._reconciliation_upsert_finding(
      p_run_id, 'T4', 'D-P-01', 'P0', 'D-P-01:' || r.withdrawal_id::TEXT,
      'withdrawal', r.withdrawal_id, NULL, NULL,
      jsonb_build_object('payout_ledger_rows', r.cnt)
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ── T5: fast composite (T1+T2+T4 core) ─────────────────────────
CREATE OR REPLACE FUNCTION public.reconciliation_execute_t5(p_run_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN public.reconciliation_execute_t1(p_run_id)
       + public.reconciliation_execute_t2(p_run_id)
       + public.reconciliation_execute_t4(p_run_id);
END;
$$;

-- ── T6: hourly (conservation + missing 48h + chains) ──────────
CREATE OR REPLACE FUNCTION public.reconciliation_execute_t6(p_run_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_delta NUMERIC;
  r RECORD;
BEGIN
  v_count := v_count + public.reconciliation_execute_t3(p_run_id);

  WITH credited AS (
    SELECT COALESCE(SUM(amount), 0) AS v FROM public.coin_transactions
     WHERE type IN ('recharge', 'admin_adjustment_add', 'refund')
  ), spent AS (
    SELECT COALESCE(SUM(ABS(amount)), 0) AS v FROM public.coin_transactions
     WHERE type = 'call_deduction'
  ), gifted AS (
    SELECT COALESCE(SUM(ABS(amount)), 0) AS v FROM public.coin_transactions
     WHERE type = 'gift_deduction'
  ), remaining AS (
    SELECT COALESCE(SUM(coins), 0) AS v FROM public.users
  )
  SELECT (SELECT v FROM credited) - (SELECT v FROM spent)
       - (SELECT v FROM gifted) - (SELECT v FROM remaining) INTO v_delta;

  IF v_delta IS DISTINCT FROM 0 THEN
    PERFORM public._reconciliation_upsert_finding(
      p_run_id, 'T6', 'SYS-DRIFT-01', 'P0', 'SYS-DRIFT-01:global',
      'system', NULL, v_delta, v_delta::INTEGER,
      jsonb_build_object('conservation_delta', v_delta)
    );
    v_count := v_count + 1;
  END IF;

  FOR r IN
    SELECT c.id AS call_id, c.caller_id, c.coins_spent
      FROM public.calls c
     WHERE c.status = 'ended' AND c.coins_spent > 0
       AND c.ended_at >= NOW() - INTERVAL '48 hours'
       AND NOT EXISTS (
         SELECT 1 FROM public.coin_transactions ct
          WHERE ct.type = 'call_deduction'
            AND ct.reference_id::text = c.id::text
       )
  LOOP
    PERFORM public._reconciliation_upsert_finding(
      p_run_id, 'T6', 'M-U-02', 'P1', 'M-U-02:' || r.call_id::TEXT,
      'call', r.call_id, NULL, r.coins_spent,
      jsonb_build_object('caller_id', r.caller_id)
    );
    v_count := v_count + 1;
  END LOOP;

  FOR r IN
    SELECT call_id, COUNT(*) AS cnt FROM public.creator_earnings
     GROUP BY call_id HAVING COUNT(*) > 1
  LOOP
    PERFORM public._reconciliation_upsert_finding(
      p_run_id, 'T6', 'D-P-06', 'P0', 'D-P-06:' || r.call_id::TEXT,
      'call', r.call_id, NULL, NULL,
      jsonb_build_object('earning_rows', r.cnt)
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ── T7: daily full missing entries + ledger replay ────────────
CREATE OR REPLACE FUNCTION public.reconciliation_execute_t7(p_run_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  r RECORD;
BEGIN
  v_count := v_count + public.reconciliation_execute_t6(p_run_id);

  FOR r IN
    SELECT c.id AS call_id, c.coins_spent, ce.gross_amount
      FROM public.calls c
      LEFT JOIN public.creator_earnings ce ON ce.call_id = c.id
     WHERE c.status = 'ended' AND c.coins_spent > 0
       AND (ce.id IS NULL OR ce.gross_amount IS DISTINCT FROM c.coins_spent::NUMERIC)
  LOOP
    PERFORM public._reconciliation_upsert_finding(
      p_run_id, 'T7', 'M-C-04', 'WARN', 'M-C-04:' || r.call_id::TEXT,
      'call', r.call_id, COALESCE(r.gross_amount, 0) - r.coins_spent, NULL,
      jsonb_build_object('coins_spent', r.coins_spent, 'gross_amount', r.gross_amount)
    );
    v_count := v_count + 1;
  END LOOP;

  FOR r IN
    SELECT w.id AS withdrawal_id, w.amount
      FROM public.withdrawals w
     WHERE w.status = 'paid'
       AND NOT EXISTS (
         SELECT 1 FROM public.creator_ledger_entries cle
          WHERE cle.entry_type = 'withdrawal_payout' AND cle.source_id = w.id
       )
  LOOP
    PERFORM public._reconciliation_upsert_finding(
      p_run_id, 'T7', 'M-C-03', 'P0', 'M-C-03:' || r.withdrawal_id::TEXT,
      'withdrawal', r.withdrawal_id, r.amount, NULL, '{}'::JSONB
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ── T8: weekly orphans + projection replay sample ─────────────
CREATE OR REPLACE FUNCTION public.reconciliation_execute_t8(p_run_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  r RECORD;
  v_rebuilt JSONB;
BEGIN
  v_count := v_count + public.reconciliation_execute_t7(p_run_id);

  FOR r IN
    SELECT ct.id, ct.reference_id, ct.type
      FROM public.coin_transactions ct
     WHERE ct.reference_id IS NOT NULL
       AND ct.type IN ('call_deduction', 'recharge', 'gift_deduction')
       AND NOT EXISTS (
         SELECT 1 FROM public.calls c WHERE c.id::TEXT = ct.reference_id::TEXT
       )
       AND ct.type = 'call_deduction'
    LIMIT 500
  LOOP
    PERFORM public._reconciliation_upsert_finding(
      p_run_id, 'T8', 'ORPHAN-CT', 'WARN', 'ORPHAN-CT:' || r.id::TEXT,
      'system', NULL, NULL, NULL,
      jsonb_build_object('reference_id', r.reference_id, 'type', r.type)
    );
    v_count := v_count + 1;
  END LOOP;

  FOR r IN
    SELECT creator_id FROM public.creator_wallets
     ORDER BY random() LIMIT 50
  LOOP
    v_rebuilt := public.rebuild_creator_wallet_from_ledger(r.creator_id);
    PERFORM public._reconciliation_upsert_finding(
      p_run_id, 'T8', 'REBUILD-SAMPLE', 'INFO',
      'REBUILD-SAMPLE:' || r.creator_id::TEXT,
      'creator', r.creator_id, NULL, NULL, v_rebuilt
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ── P0 freeze trigger on new findings ─────────────────────────
CREATE OR REPLACE FUNCTION public._reconciliation_freeze_on_p0()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.severity = 'P0' AND NEW.status = 'open' THEN
    IF NEW.entity_type = 'user' AND NEW.entity_id IS NOT NULL THEN
      PERFORM public._reconciliation_auto_freeze_p0(
        NEW.id, 'user', NEW.entity_id, NEW.check_id || ': ' || NEW.fingerprint
      );
    ELSIF NEW.entity_type = 'creator' AND NEW.entity_id IS NOT NULL THEN
      PERFORM public._reconciliation_auto_freeze_p0(
        NEW.id, 'creator', NEW.entity_id, NEW.check_id || ': ' || NEW.fingerprint
      );
    ELSIF NEW.check_id LIKE 'D-P-%' OR NEW.check_id = 'SYS-DRIFT-01' THEN
      PERFORM public._reconciliation_auto_freeze_p0(
        NEW.id, 'system', NULL, 'global_payout_freeze: ' || NEW.check_id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reconciliation_p0_freeze ON public.reconciliation_findings;
CREATE TRIGGER trg_reconciliation_p0_freeze
  AFTER INSERT ON public.reconciliation_findings
  FOR EACH ROW EXECUTE FUNCTION public._reconciliation_freeze_on_p0();

-- ── reconciliation_run orchestrator ───────────────────────────
CREATE OR REPLACE FUNCTION public.reconciliation_run(p_tier TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id UUID;
  v_lock_key BIGINT;
  v_checks INTEGER := 0;
  v_new INTEGER := 0;
  v_open INTEGER;
BEGIN
  IF p_tier NOT IN ('T0','T1','T2','T3','T4','T5','T6','T7','T8') THEN
    RAISE EXCEPTION 'invalid_tier: %', p_tier;
  END IF;

  v_lock_key := hashtext('recon_' || p_tier);
  IF NOT pg_try_advisory_xact_lock(v_lock_key) THEN
    INSERT INTO public.reconciliation_runs (tier, status, summary_json)
    VALUES (p_tier, 'skipped', '{"reason":"advisory_lock_held"}'::JSONB)
    RETURNING id INTO v_run_id;
    RETURN jsonb_build_object('run_id', v_run_id, 'status', 'skipped');
  END IF;

  INSERT INTO public.reconciliation_runs (tier, status)
  VALUES (p_tier, 'running')
  RETURNING id INTO v_run_id;

  CASE p_tier
    WHEN 'T0' THEN v_checks := public.reconciliation_execute_t0(v_run_id);
    WHEN 'T1' THEN v_checks := public.reconciliation_execute_t1(v_run_id);
    WHEN 'T2' THEN v_checks := public.reconciliation_execute_t2(v_run_id);
    WHEN 'T3' THEN v_checks := public.reconciliation_execute_t3(v_run_id);
    WHEN 'T4' THEN v_checks := public.reconciliation_execute_t4(v_run_id);
    WHEN 'T5' THEN v_checks := public.reconciliation_execute_t5(v_run_id);
    WHEN 'T6' THEN v_checks := public.reconciliation_execute_t6(v_run_id);
    WHEN 'T7' THEN v_checks := public.reconciliation_execute_t7(v_run_id);
    WHEN 'T8' THEN v_checks := public.reconciliation_execute_t8(v_run_id);
  END CASE;

  SELECT COUNT(*) INTO v_open
    FROM public.reconciliation_findings WHERE status = 'open';

  UPDATE public.reconciliation_runs
     SET status = 'completed',
         finished_at = NOW(),
         duration_ms = (EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000)::INTEGER,
         checks_executed = v_checks,
         findings_open = v_open,
         summary_json = jsonb_build_object('checks_executed', v_checks, 'findings_open', v_open)
   WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'tier', p_tier,
    'status', 'completed',
    'checks_executed', v_checks,
    'findings_open', v_open
  );
EXCEPTION WHEN OTHERS THEN
  UPDATE public.reconciliation_runs
     SET status = 'failed', finished_at = NOW(),
         error_message = SQLERRM,
         duration_ms = (EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000)::INTEGER
   WHERE id = v_run_id;
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.reconciliation_run(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconciliation_run(TEXT) TO service_role;

COMMIT;
