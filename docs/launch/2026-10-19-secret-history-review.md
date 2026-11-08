# Historical credential review — 19 October 2026

**Rotation required.** An older commit hardcodes a USDA credential in
`app/(tabs)/add.tsx:34`, commit `a043c347709948970e7aa3f4bda7a329e8e17441`.
Treat it as exposed even though it is absent from the current tracked files and
the freshly exported web build. Its validity and relationship to the current
server secret were not tested. No credential value is included in this report.

The [USDA API guide](https://fdc.nal.usda.gov/api-guide/) requires keeping keys
private and warns that publicly discovered keys can be deactivated. Deleting a
line or changing a hosting variable does not revoke a historical credential.

## Evidence and limits

- Verified the official Gitleaks 8.30.1 Linux binary against its published
  release checksum, then scanned all 266 locally reachable commits with
  redaction enabled and a 120-second limit. No application dependency was added.
- Three findings were triaged: the historical USDA credential; a public
  Supabase JWT whose role is `anon`, not `service_role`; and a false positive on
  SQL identifiers used to generate/renew a billing lease token.
- Compared the historical USDA literal against current tracked files and the
  current `dist/` files in memory: no matches. The full scanner report was
  removed after retaining only rule/path/line/commit/classification metadata in
  ignored `output/release/setup/history-secrets-metadata.json`.
- This does not prove every possible secret format is detected. Unfetched
  history, forks, deployment history and old/lazy hosted assets were not scanned.
  The limited live-script check in the [hosting record](2026-10-19-release-connection.md)
  does not change the rotation requirement. No provider call used the old key.

## Operator recovery

1. Obtain a replacement and arrange revocation of the exposed key through the
   USDA/api.data.gov account or support process. Do not send either key in chat.
2. Save **only** the replacement `USDA_API_KEY` assignment in an ignored local
   file, `supabase/.env.usda-rotation`, with permissions `600`. Do not copy the
   whole server example: unrelated placeholder secrets must not be uploaded.
3. Update the intended project's Edge Function secret through Supabase's
   dashboard or its [documented secret-file command](https://supabase.com/docs/guides/functions/secrets):

   ```sh
   git check-ignore supabase/.env.usda-rotation
   chmod 600 supabase/.env.usda-rotation
   supabase secrets set --env-file supabase/.env.usda-rotation --project-ref <verified-project-ref>
   ```

4. Use an operator test account to verify one authenticated food lookup and its
   source; confirm the replacement stays out of the app bundle and logs. Remove
   the temporary secret file when finished. Record revocation/verification
   without recording values.

Do not restore the public USDA hosting variable. Do not rewrite or force-push
shared history as a substitute for revocation. No key rotation, production
deployment or customer-data mutation was performed by this audit. The security
launch item remains incomplete until the operator verifies recovery.
