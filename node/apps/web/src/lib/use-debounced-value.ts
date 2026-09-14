import { useEffect, useState } from "react";

/**
 * The value as it was once typing paused for `delay` milliseconds.
 *
 * For checks that ask the server something about a box while it is being typed
 * in. Without it, typing "OPC 53 Grade Cement" sends nineteen requests and the
 * answers can arrive out of order, so the message under the box ends up
 * describing a name the person typed several keys ago.
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return settled;
}
