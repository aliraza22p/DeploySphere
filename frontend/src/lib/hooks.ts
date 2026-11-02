import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ApiError, apiFetch } from "./api";
import { useToast } from "../components/ui/toast";

/**
 * Standard data hook for all pages: loading, error and refetch states with
 * optional background refresh (`refetchInterval`) so dashboards stay current
 * even before a WebSocket event arrives.
 */
export function useApi<T>(
  path: string | null,
  options?: {
    refetchInterval?: number;
    enabled?: boolean;
  },
): UseQueryResult<T, ApiError> {
  const enabled = Boolean(path) && options?.enabled !== false;
  return useQuery<T, ApiError>({
    queryKey: ["api", path],
    enabled,
    refetchInterval: options?.refetchInterval ?? false,
    staleTime: 5_000,
    retry: (count, error) => {
      if (error instanceof ApiError && error.status < 500) return false;
      return count < 2;
    },
    queryFn: () => apiFetch<T>(path as string),
  });
}

/** Mutation helper with consistent error handling and success toasts. */
export function useApiMutation<TVars, TData>(
  fn: (vars: TVars) => Promise<TData>,
  callbacks?: {
    onSuccess?: (data: TData, vars: TVars) => void | Promise<void>;
    onError?: (error: ApiError, vars: TVars) => void;
    successMessage?: string | ((data: TData, vars: TVars) => string);
  },
): {
  mutate: (vars: TVars) => Promise<TData | undefined>;
  isPending: boolean;
} {
  const toast = useToast();
  const navigate = useNavigate();
  const [isPending, setIsPending] = useState(false);

  const mutate = useCallback(
    async (vars: TVars): Promise<TData | undefined> => {
      setIsPending(true);
      try {
        const data = await fn(vars);
        if (callbacks?.successMessage) {
          const msg =
            typeof callbacks.successMessage === "function"
              ? callbacks.successMessage(data, vars)
              : callbacks.successMessage;
          toast.success(msg);
        }
        await callbacks?.onSuccess?.(data, vars);
        return data;
      } catch (err) {
        const apiError =
          err instanceof ApiError
            ? err
            : new ApiError(err instanceof Error ? err.message : "Unexpected error", {
                status: 0,
              });
        if (callbacks?.onError) callbacks.onError(apiError, vars);
        else toast.error(apiError.message);
        if (apiError.status === 401) navigate("/login");
        return undefined;
      } finally {
        setIsPending(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fn, toast, navigate],
  );

  return { mutate, isPending };
}
