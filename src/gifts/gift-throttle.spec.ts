import { GIFT_SEND_RATE_LIMIT } from './gift.controller';

describe('GiftController rate limits', () => {
  it('allows 30 gift sends per minute', () => {
    expect(GIFT_SEND_RATE_LIMIT).toEqual({ limit: 30, ttl: 60_000 });
  });
});
