import { useAuth as useClerkAuth, useClerk } from "@clerk/react";
import { trpc } from "@/lib/trpc";

export function useAuth() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { openSignIn, signOut } = useClerk();
  const me = trpc.auth.me.useQuery(undefined, {
    enabled: isLoaded && isSignedIn,
    retry: false,
  });

  return {
    user: me.data ?? null,
    loading: !isLoaded || (isSignedIn && me.isLoading),
    error: me.error,
    login: () => openSignIn(),
    logout: async () => {
      await signOut({ redirectUrl: "/" });
    },
    isLoggingOut: false,
  };
}
