/** Creator end-call duplicate incoming — pure logic contract tests (no Nest DI). */

type MemCallRequest = {
  id: string;
  callId?: string;
  status: string;
};

function finalizeCallRequestsForEndedSession(
  callId: string,
  memCallRequests: MemCallRequest[],
): string | undefined {
  const linked = memCallRequests.filter((r) => r.callId === callId);
  const primaryId = linked[0]?.id;
  for (const memReq of linked) {
    if (memReq.status === 'requested') memReq.status = 'cancelled';
  }
  return primaryId;
}

function filterPendingRequests(rows: { id: string; status: string; call_id: string | null }[]) {
  return rows.filter((r) => r.status === 'requested' && r.call_id === null);
}

describe('Creator end-call duplicate incoming', () => {
  it('finalizeCallRequestsForEndedSession cancels stale requested rows in memory', () => {
    const memCallRequests: MemCallRequest[] = [
      { id: 'req-accepted', callId: 'call-1', status: 'accepted' },
      { id: 'req-stale', callId: 'call-1', status: 'requested' },
    ];

    const callRequestId = finalizeCallRequestsForEndedSession('call-1', memCallRequests);

    expect(callRequestId).toBe('req-accepted');
    expect(memCallRequests.find((r) => r.id === 'req-stale')?.status).toBe('cancelled');
    expect(memCallRequests.find((r) => r.id === 'req-accepted')?.status).toBe('accepted');
  });

  it('pending query excludes rows already linked to a call session', () => {
    const rows = [
      { id: 'a', status: 'accepted', call_id: 'call-1' },
      { id: 'b', status: 'requested', call_id: null },
      { id: 'c', status: 'requested', call_id: 'call-2' },
    ];
    expect(filterPendingRequests(rows)).toEqual([
      { id: 'b', status: 'requested', call_id: null },
    ]);
  });
});
