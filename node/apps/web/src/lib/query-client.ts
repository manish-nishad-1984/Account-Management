import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api-client";

export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Reference data (countries, states, units, forms) is re-fetched on every
        // request today from ~40 call sites. Caching it here is most of that fix.
        retry: (failureCount, error) => {
          // Never retry an auth or validation failure — it will never succeed.
          if (error instanceof ApiError && error.status < 500) {
            return false;
          }
          return failureCount < 2;
        },
        refetchOnWindowFocus: false,
      },
    },
  });
