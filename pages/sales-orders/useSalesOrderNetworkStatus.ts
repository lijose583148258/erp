import { useEffect, useState } from 'react';

export const useSalesOrderNetworkStatus = () => {
    const [isOffline, setIsOffline] = useState(() => !navigator.onLine);

    useEffect(() => {
        const handleNetwork = () => setIsOffline(!navigator.onLine);
        window.addEventListener('online', handleNetwork);
        window.addEventListener('offline', handleNetwork);
        return () => {
            window.removeEventListener('online', handleNetwork);
            window.removeEventListener('offline', handleNetwork);
        };
    }, []);

    return isOffline;
};
