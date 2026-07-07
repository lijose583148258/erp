import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { isCanceledApiError } from '../utils/api';

export const serverStateQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 5 * 60_000,
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => !isCanceledApiError(error) && failureCount < 2,
      staleTime: 30_000,
    },
  },
});

type ServerStateProviderProps = {
  children: React.ReactNode;
};

export const ServerStateProvider = ({ children }: ServerStateProviderProps) => (
  <QueryClientProvider client={serverStateQueryClient}>
    {children}
  </QueryClientProvider>
);
