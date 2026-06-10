import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION = readFileSync(
  join(__dirname, '../../supabase/migrations/20260611000000_engagement_sprint33b_sprint5.sql'),
  'utf8',
);

describe('Sprint 3.3B Sprint 5 paid messages migration', () => {
  it('creates message_sessions', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.message_sessions/);
    expect(MIGRATION).toMatch(/uq_message_sessions_user_creator/);
  });

  it('creates paid_messages evidence table', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.paid_messages/);
    expect(MIGRATION).toMatch(/idempotency_key\s+TEXT NOT NULL UNIQUE/);
  });

  it('creates message_unlocks and message_events', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.message_unlocks/);
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.message_events/);
    expect(MIGRATION).toMatch(/uq_message_events_idempotency/);
  });

  it('creates conversation_summaries L3 projection', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.conversation_summaries/);
    expect(MIGRATION).toMatch(/rebuild_conversation_summary/);
    expect(MIGRATION).toMatch(/rebuild_conversation_summaries/);
  });

  it('extends financial source types', () => {
    expect(MIGRATION).toMatch(/message_unlock/);
    expect(MIGRATION).toMatch(/message_send/);
    expect(MIGRATION).toMatch(/message_earning/);
  });

  it('defines message RPCs', () => {
    expect(MIGRATION).toMatch(/ensure_message_session/);
    expect(MIGRATION).toMatch(/unlock_message_session/);
    expect(MIGRATION).toMatch(/send_paid_message/);
    expect(MIGRATION).toMatch(/get_message_conversations/);
    expect(MIGRATION).toMatch(/get_message_session_detail/);
    expect(MIGRATION).toMatch(/get_message_history/);
  });

  it('denies client RLS', () => {
    expect(MIGRATION).toMatch(/message_sessions_deny_clients/);
    expect(MIGRATION).toMatch(/paid_messages_deny_clients/);
    expect(MIGRATION).toMatch(/conversation_summaries_deny_clients/);
  });
});
