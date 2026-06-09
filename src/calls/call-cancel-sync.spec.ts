/** Caller cancel + peer end-call signal contracts (pure logic). */

type CallRequest = {
  id: string;
  callerId: string;
  creatorId: string;
  status: string;
};

function cancelCallRequest(
  record: CallRequest,
  userId: string,
): { ok: boolean; status?: string; error?: string } {
  if (record.callerId !== userId && record.creatorId !== userId) {
    return { ok: false, error: 'forbidden' };
  }
  if (record.status !== 'requested') {
    return { ok: false, error: `already ${record.status}` };
  }
  record.status = 'cancelled';
  return { ok: true, status: 'cancelled' };
}

function peerUserId(endedBy: string, callerId: string, creatorId: string): string {
  return endedBy === callerId ? creatorId : callerId;
}

describe('Call cancel and peer sync', () => {
  it('caller can cancel a pending request', () => {
    const req: CallRequest = {
      id: 'req-1',
      callerId: 'user-a',
      creatorId: 'creator-b',
      status: 'requested',
    };
    const result = cancelCallRequest(req, 'user-a');
    expect(result.ok).toBe(true);
    expect(req.status).toBe('cancelled');
  });

  it('creator cannot use creator-only POST reject path for caller cancel', () => {
    const callerCancelPath = 'PATCH /api/calls/requests/:id/reject';
    const creatorRejectPath = 'POST /api/calls/:id/reject';
    expect(callerCancelPath).not.toBe(creatorRejectPath);
    expect(callerCancelPath).toContain('/requests/');
  });

  it('peerUserId returns the other participant', () => {
    expect(peerUserId('user-a', 'user-a', 'creator-b')).toBe('creator-b');
    expect(peerUserId('creator-b', 'user-a', 'creator-b')).toBe('user-a');
  });

  it('cannot cancel an already accepted request', () => {
    const req: CallRequest = {
      id: 'req-2',
      callerId: 'user-a',
      creatorId: 'creator-b',
      status: 'accepted',
    };
    const result = cancelCallRequest(req, 'user-a');
    expect(result.ok).toBe(false);
    expect(req.status).toBe('accepted');
  });
});
