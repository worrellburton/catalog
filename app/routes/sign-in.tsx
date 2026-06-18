import ClerkAuthScreen from '~/components/ClerkAuthScreen';

// /sign-in — Clerk sign-in page (Google SSO + phone, per dashboard config).
// Code-split: the Clerk SDK loads only when this route is visited.
export default function SignInRoute() {
  return <ClerkAuthScreen mode="sign-in" />;
}
