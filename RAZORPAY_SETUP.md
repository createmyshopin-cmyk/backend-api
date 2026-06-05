# Razorpay setup (Test mode)

## Railway variables

| Variable | Example | Notes |
|----------|---------|--------|
| `RAZORPAY_KEY_ID` | `rzp_test_Sxti83SGwNxBQh` | Copy exactly from dashboard (case-sensitive) |
| `RAZORPAY_KEY_SECRET` | 24-character secret | Shown **once** when key is generated |

- No quotes around values
- No spaces or line breaks
- Key ID and Secret must be from the **same** generated key pair

## Generate keys

1. [Razorpay Dashboard](https://dashboard.razorpay.com) → **Account & Settings** → **API Keys**
2. Enable **Test mode** (top toggle)
3. Click **Generate key**
4. Copy **Key ID** and **Key Secret** immediately
5. Paste into Railway → redeploy `backend-api`

## Verify after deploy

```bash
curl -H "Authorization: Bearer YOUR_JWT" \
  https://backend-api-production-140f.up.railway.app/api/payments/gateway-status
```

Expected when working:

```json
{ "mode": "razorpay", "message": "Razorpay API keys accepted" }
```

If `mode` is `mock`, keys still do not match — regenerate again.

## App behaviour

| `mode` | User experience |
|--------|-----------------|
| `mock` | Coins added without Razorpay UI (test fallback) |
| `razorpay` | Razorpay checkout opens; use test card `4111 1111 1111 1111` |
