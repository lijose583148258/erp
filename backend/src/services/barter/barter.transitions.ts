export function assertBarterApprovalTransition(status: string) {
  if (status === 'reversed') {
    throw new Error('Reversed settlement cannot be approved');
  }
  if (status === 'posted') {
    throw new Error('Posted settlement cannot be approved again');
  }
  if (status === 'closed') {
    throw new Error('Closed settlement cannot be approved');
  }
  if (status !== 'draft' && status !== 'quoted') {
    throw new Error(`Settlement status ${status} cannot be approved`);
  }
}

export function assertBarterPostingTransition(status: string) {
  if (status === 'reversed') {
    throw new Error('Reversed settlement cannot be posted');
  }
  if (status === 'posted') {
    throw new Error('Posted settlement cannot be posted again');
  }
  if (status === 'closed') {
    throw new Error('Closed settlement cannot be posted');
  }
  if (status !== 'approved') {
    throw new Error('Only approved settlements can be posted');
  }
}

export function assertBarterReversalTransition(status: string) {
  if (status === 'reversed') {
    throw new Error('Settlement has already been reversed');
  }
  if (status === 'closed') {
    throw new Error('Closed settlement cannot be reversed');
  }
  if (status !== 'approved' && status !== 'posted') {
    throw new Error(`Settlement status ${status} cannot be reversed`);
  }
}
