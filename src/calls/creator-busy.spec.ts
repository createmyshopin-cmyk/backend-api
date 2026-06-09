/** One-call-at-a-time rules for creators (pure logic). */

type BusyCallRequest = {
  id: string;
  callerId: string;
  creatorId: string;
  status: string;
  callId?: string;
};

type BusyCallSession = {
  id: string;
  creatorId: string;
  callerId: string;
  status: string;
};

const ACTIVE = ['requested', 'accepted', 'ringing', 'ongoing'];

function creatorIsBusy(
  creatorId: string,
  requests: BusyCallRequest[],
  sessions: BusyCallSession[],
): boolean {
  const pending = requests.some(
    (r) =>
      r.creatorId === creatorId &&
      r.status === 'requested' &&
      !r.callId,
  );
  if (pending) return true;
  return sessions.some(
    (s) => s.creatorId === creatorId && ACTIVE.includes(s.status),
  );
}

function pendingForCreator(
  creatorId: string,
  requests: BusyCallRequest[],
): BusyCallRequest[] {
  return requests
    .filter(
      (r) =>
        r.creatorId === creatorId &&
        r.status === 'requested' &&
        !r.callId,
    )
    .slice(0, 1);
}

describe('Creator one-call-at-a-time', () => {
  it('creator is busy when a ringing request exists', () => {
    expect(
      creatorIsBusy(
        'creator-1',
        [
          {
            id: 'req-1',
            callerId: 'user-a',
            creatorId: 'creator-1',
            status: 'requested',
          },
        ],
        [],
      ),
    ).toBe(true);
  });

  it('creator is busy when an active session exists', () => {
    expect(
      creatorIsBusy(
        'creator-1',
        [],
        [
          {
            id: 'call-1',
            callerId: 'user-a',
            creatorId: 'creator-1',
            status: 'ongoing',
          },
        ],
      ),
    ).toBe(true);
  });

  it('creator is free when no pending request or active session', () => {
    expect(
      creatorIsBusy(
        'creator-1',
        [{ id: 'r', callerId: 'u', creatorId: 'creator-1', status: 'cancelled' }],
        [{ id: 'c', callerId: 'u', creatorId: 'creator-1', status: 'ended' }],
      ),
    ).toBe(false);
  });

  it('pending endpoint returns at most one orphan request', () => {
    const rows: BusyCallRequest[] = [
      { id: 'a', callerId: 'u1', creatorId: 'c1', status: 'requested' },
      { id: 'b', callerId: 'u2', creatorId: 'c1', status: 'requested' },
      {
        id: 'c',
        callerId: 'u3',
        creatorId: 'c1',
        status: 'accepted',
        callId: 'call-9',
      },
    ];
    expect(pendingForCreator('c1', rows)).toEqual([rows[0]]);
  });
});
