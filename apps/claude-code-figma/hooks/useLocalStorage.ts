import { useEffect, useState } from "react";

export function useLocalStorage<T>(key: string, initialValue: T) {
  // 서버와 클라이언트에서 동일한 초기값으로 시작 (Hydration 문제 방지)
  const [storedValue, setStoredValue] = useState<T>(initialValue);

  // 클라이언트에서만 localStorage 값 로드
  useEffect(() => {
    try {
      const item = localStorage.getItem(key);
      if (item) {
        setStoredValue(JSON.parse(item));
      }
    } catch (error) {
      console.warn(`Error loading localStorage key "${key}":`, error);
    } finally {
    }
  }, [key]);

  // 값 업데이트 및 localStorage 저장
  const setValue = (value: T | ((val: T) => T)) => {
    try {
      const valueToStore =
        value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);

      if (typeof window !== "undefined") {
        localStorage.setItem(key, JSON.stringify(valueToStore));
      }
    } catch (error) {
      console.error(`Error setting localStorage key "${key}":`, error);
    }
  };

  return [storedValue, setValue] as const;
}
