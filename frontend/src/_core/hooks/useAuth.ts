import { useAuth as useClerkAuth, useClerk, useUser } from "@clerk/react";

export function useAuth() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { openSignIn, signOut } = useClerk();
  const { user: clerkUser } = useUser();
  const user = isSignedIn && clerkUser
    ? {
        id: clerkUser.id,
        name: clerkUser.fullName ?? clerkUser.username ?? "Heatcheck user",
        email: clerkUser.primaryEmailAddress?.emailAddress ?? null,
      }
    : null;

  return {
    user,
    loading: !isLoaded,
    error: null,
    login: () => openSignIn(),
    logout: async () => {
      await signOut({ redirectUrl: "/" });
    },
    isLoggingOut: false,
  };
}
