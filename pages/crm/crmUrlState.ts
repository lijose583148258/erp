export type CRMUrlState = {
  viewMode: 'my' | 'public';
  segmentFilter: 'all' | 'direct' | 'channel' | 'mixed';
  searchKeyword: string;
  currentPage: number;
};

export const readCRMUrlState = (): CRMUrlState => {
  const params =
    typeof window === 'undefined'
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search);
  const view = params.get('crmView');
  const segment = params.get('crmSegment');
  const page = Number(params.get('crmPage'));

  return {
    viewMode: view === 'public' ? 'public' : 'my',
    segmentFilter: segment === 'direct' || segment === 'channel' || segment === 'mixed' ? segment : 'all',
    searchKeyword: params.get('crmSearch') || '',
    currentPage: Number.isInteger(page) && page > 0 ? page : 1,
  };
};
