import ClerkAuthScreen from '~/components/ClerkAuthScreen';

// /sign-up — Clerk sign-up page (Google SSO + phone, per dashboard config).
// Code-split: the Clerk SDK loads only when this route is visited.
export default function SignUpRoute() {
  return <ClerkAuthScreen mode="sign-up" />;
}
