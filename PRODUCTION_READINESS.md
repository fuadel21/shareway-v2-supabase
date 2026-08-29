# Production Readiness Report

## Status: NOT READY for public launch

The product core (RPC ride lifecycle, Stripe webhook signature verification, static CI audits) is in beta shape. The repository still had committed secrets, a client-trusted booking amount, and incomplete Edge Function deploys.

### Security hardening in this branch

- Removed tracked Stripe secrets from `functions/.env.txt` and Playwright auth tokens from `e2e/.auth/`.
- Added `.env.example` (public Vite keys only).
- Booking PaymentIntents now reject amounts that do not match the server-side ride price.
- `create-ride` Edge Function goes through the `create_ride` RPC instead of inserting into `rides`.
- Stripe Connect onboarding is bound to the authenticated user, not a client-supplied `userId`.
- Escrow no longer returns a fake `25.50` balance.
- Notification test page is admin-only.
- Vercel security headers added. Auto-deploy remains **disabled** (`git.deploymentEnabled: false`) until secrets are rotated and functions are deployed.
- Edge Function deploy workflow still only publishes `send-push` (GitHub App cannot update workflow files). Deploy the rest with `supabase functions deploy`.

### Must do outside this repo

1. **Rotate** the leaked Stripe test secret and webhook secret in the Stripe dashboard.
2. Put `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, and VAPID keys in Supabase Edge Function secrets. Never in Vite `VITE_*` vars.
3. Confirm GitHub secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`.
4. Deploy Edge Functions (workflow or `supabase functions deploy`).
5. Turn Vercel git deploys on only after the above.

### Still open before public launch

- No Sentry / error tracking.
- Wallet `confirm_trip_and_pay` still accepts a client `p_price` in SQL.
- CORS is tightened in `_shared/cors.ts`; many functions still inline `*`.
- Capacitor/Android still points at the legacy Firebase app `taxi-compartido-v2`.
- No `.env.example` was previously present; document production env in Vercel.

### Checks

```bash
pnpm run audit:production
pnpm run audit:sensitive
pnpm run build
```
