/**
 * Razorpay is a CommonJS package (`module.exports = Razorpay`).
 * Default ESM imports compile to `.default`, which is undefined at runtime.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const RazorpayConstructor = require('razorpay') as typeof import('razorpay');

export type RazorpayInstance = InstanceType<typeof RazorpayConstructor>;

export function createRazorpayClient(options: {
  key_id: string;
  key_secret: string;
}): RazorpayInstance {
  return new RazorpayConstructor(options);
}
