import { useState, useEffect } from 'react';

export function useWindowSize() {
  const getSize = () => ({
    width: window.innerWidth + 'px',
    height: window.innerHeight + 'px',
  });

  const [size, setSize] = useState(() =>
    typeof window !== 'undefined' ? getSize() : { width: '100vw', height: '100vh' },
  );

  useEffect(() => {
    function handleResize() {
      setSize(getSize());
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return size;
}
