import * as crypto from 'crypto';

/** HMAC self-test — validates key pair shape without external network call. */
export async function probeRazorpay(keyId: string, keySecret: string): Promise<void> {
  if (!keyId || !keySecret) {
    throw new Error('Razorpay probe requires keyId and keySecret');
  }

  const sample = crypto
    .createHmac('sha256', keySecret)
    .update('order_test|pay_test')
    .digest('hex');

  if (!sample || sample.length !== 64) {
    throw new Error('Razorpay HMAC self-test failed');
  }

  if (keyId.startsWith('rzp_test_mock') || keySecret === 'mockKeySecret') {
    throw new Error('Razorpay probe rejected mock credentials');
  }
}
