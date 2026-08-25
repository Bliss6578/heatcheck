import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";

export function useAuth() {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      window.location.assign("/");
    },
  });

  return {
    user: me.data ?? null,
    loading: me.isLoading,
    error: me.error,
    login: startLogin,
    logout: () => logoutMutation.mutateAsync(),
    isLoggingOut: logoutMutation.isPending,
  };
}
