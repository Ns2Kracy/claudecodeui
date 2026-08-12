import { useEffect, useState } from 'react';

export function useSelectedProvider() {
  const [provider, setProvider] = useState('codex');

  useEffect(() => {
    // Keep provider in sync when another tab changes the selected provider.
    const handleStorageChange = () => {
      setProvider('codex');
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  return provider;
}
