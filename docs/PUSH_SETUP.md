# Push notifications: setup

Notifications are sent by the `notify` Supabase Edge Function using Web Push (VAPID). The app calls it right
after a chore is completed. These steps are one-time.

How it works, briefly:

1. A device taps **Enable notifications** and its browser hands back a push subscription, which the app saves
   with `save_push_subscription` (passcode-checked) under whoever is using that device.
2. When someone completes a chore, `complete_chore` returns the new activity row's id and the app calls
   `notify` with it.
3. `notify` *claims* that activity row by setting `notified_at` (only if it is still null and under 2 minutes
   old), then sends "Sam finished the dishes. Next up: Alex." to every subscription **except the completer's**.
   Because of the claim, each completion notifies at most once, which is why it is safe for the function to be
   callable with the public key.

The same function also sends the anonymous-bump nudge ("Friendly nudge: the trash is waiting on you.") to just the
person who was bumped. Milestone 5's migration (`20261001000400_bump.sql`) adds what it needs; after running it,
redeploy `notify` (step 3's deploy command) so the function knows about bumps.

## 1. Database

Run `supabase/migrations/20261001000300_push.sql` in the Supabase SQL editor (after the earlier migrations).

## 2. Keys

A VAPID keypair was generated for you into two gitignored places:

- `supabase/push-secrets.local`: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. **Secret. Never commit or share.**
- `.env`: `VITE_VAPID_PUBLIC_KEY` (the public half, safe to ship in the app).

`VAPID_SUBJECT` is a contact URL or `mailto:` address that push services see. It defaults to the repo URL; change
it to any `https://` URL or `mailto:` you control.

To generate a fresh pair on another machine: a P-256 keypair, public key as base64url of the 65-byte uncompressed
point, private key as base64url of the 32-byte scalar (`npx web-push generate-vapid-keys` does exactly this).
**Rotating keys breaks every existing subscription**: each device has to re-enable notifications.

## 3. Deploy the function (Supabase CLI)

```bash
brew install supabase/tap/supabase
supabase login                      # opens a browser; you do this part
supabase functions deploy notify --no-verify-jwt --use-api --project-ref YOUR-PROJECT-REF
supabase secrets set --env-file supabase/push-secrets.local --project-ref YOUR-PROJECT-REF
```

- `--no-verify-jwt` is required. The app authenticates with a publishable key, which is not a JWT, so Supabase's
  built-in JWT check would reject every call.
- `secrets set --env-file` reads the secrets straight from the local file, so you never paste the private key.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to the function automatically.

## 4. Hosting

Phones need an **HTTPS** address (localhost won't do), so deploy the frontend (Vercel) and set these environment
variables there: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`.

## 5. Turn it on, per phone

- **iPhone/iPad (iOS 16.4+)**: open the site in Safari, Share, **Add to Home Screen**, open the app from the
  home screen, tap **Enable notifications**. Notifications do not work from a plain Safari tab.
- **Android/desktop Chrome**: open the site and tap **Enable notifications**. Installing is optional.

## Troubleshooting

- **Nothing arrives.** Supabase dashboard, Edge Functions, `notify`, Logs. The response summarises each call:
  `{"sent":2,"pruned":0,"failed":0}`. `sent: 0, reason: ...` means the completion was already announced or older
  than 2 minutes. A boot error such as `Missing secret VAPID_...` means step 3's `secrets set` hasn't run.
- **The person who completed it gets nothing.** By design.
- **"Notifications are blocked."** The browser or phone setting is set to deny. Change it there; the app can't.
- **Dead devices** (uninstalled app, revoked permission) are removed automatically the next time a push to them
  gets a 404/410.
- **Switching person on a phone** re-files that phone's subscription under the new person automatically.
