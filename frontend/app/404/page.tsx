import NotFoundPage from "../not-found";

/**
 * A routable twin of `not-found.tsx`, because middleware can only rewrite
 * to a real path (it rewrites here on a tenant/host mismatch — see
 * middleware.ts).
 */
export default function NotFoundRoute() {
  return <NotFoundPage />;
}
