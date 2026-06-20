import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from './AppContext';

type Options<T> = {
  sourceId: string;
  label: string;
  open: boolean;
  value: T;
  resetKey?: string | number | null;
};

export const useUnsavedForm = <T,>({ sourceId, label, open, value, resetKey = null }: Options<T>) => {
  const { registerUnsavedChanges, confirmDiscardChanges } = useAppContext();
  const snapshot = useMemo(() => JSON.stringify(value), [value]);
  const [baseline, setBaseline] = useState<string | null>(null);

  useEffect(() => {
    setBaseline(open ? snapshot : null);
  }, [open, resetKey]);

  const dirty = open && baseline !== null && snapshot !== baseline;

  useEffect(() => {
    registerUnsavedChanges(sourceId, label, dirty);
    return () => registerUnsavedChanges(sourceId, label, false);
  }, [dirty, label, registerUnsavedChanges, sourceId]);

  const requestClose = useCallback(
    (close: () => void) => {
      if (!dirty || confirmDiscardChanges()) close();
    },
    [confirmDiscardChanges, dirty],
  );

  return { dirty, requestClose };
};
