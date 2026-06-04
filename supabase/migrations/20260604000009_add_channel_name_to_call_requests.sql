-- Pre-generated Agora channel name sent in FCM payload at request time
ALTER TABLE call_requests ADD COLUMN IF NOT EXISTS channel_name text;
