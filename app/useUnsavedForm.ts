import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from './AppContext';

type Options<T> = {
  sourceId: string;
  label: string;
  open: boolean;
  value: T;
  enabled?: boolean;
  touched?: boolean;
  resetKey?: string | number | null;
};

export const useUnsavedForm = <T,>({
  sourceId,
  label,
  open,
  value,
  enabled = true,
  touched = true,
  resetKey = null,
}: Options<T>) => {
  const { registerUnsavedChanges, confirmDiscardChanges } = useAppContext();
  const snapshot = useMemo(() => JSON.stringify(value), [value]);
  const snapshotRef = useRef(snapshot);
  const [baseline, setBaseline] = useState<string | null>(null);
  const isEnabled = open && enabled;

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    setBaseline(isEnabled ? snapshotRef.current : null);
  }, [isEnabled, resetKey]);

  const dirty = isEnabled && touched && baseline !== null && snapshot !== baseline;

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
