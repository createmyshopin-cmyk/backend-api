-- FCM device token for push notifications (POST /api/users/fcm-token)
ALTER TABLE users ADD COLUMN IF NOT EXISTS fcm_token text;
