import { useEffect, useState, useRef } from "react";

interface UsePollingOptions {
  interval?: number;
  enabled?: boolean;
  immediate?: boolean;
}

interface UsePollingResult<T> {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function usePolling<T>(
  fetchFn: () => Promise<T>,
  options: UsePollingOptions = {}
): UsePollingResult<T> {
  const { interval = 30000, enabled = true, immediate = true } = options;
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(immediate);
  const [error, setError] = useState<Error | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchData = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await fetchFn();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unknown error"));
    } finally {
      setIsLoading(false);
    }
  };

  const refetch = fetchData;

  useEffect(() => {
    if (!enabled) return;

    if (immediate) {
      fetchData();
    }

    // Set up polling
    intervalRef.current = setInterval(() => {
      // Only poll if the tab is visible to save resources
      if (!document.hidden) {
        fetchData();
      }
    }, interval);

    // Handle visibility change
    const handleVisibilityChange = () => {
      if (!document.hidden && intervalRef.current) {
        fetchData();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, interval, immediate]);

  return { data, isLoading, error, refetch };
}
