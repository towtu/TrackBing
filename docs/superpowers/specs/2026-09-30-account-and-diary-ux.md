# Account recovery and diary controls

User-approved scope: implement useful product additions autonomously; specifically include email password changes and everyday UX. Preserve the existing Expo/Supabase stack, owner policies, design and food/weight write paths.

## Decisions

- `/recover` is public and noindex. Send a Supabase recovery email, verify its six-digit code in a separate nonpersistent client, then update the password. Never put recovery sessions in the main app's storage. Supabase owns OTP validation, password rules and rate limits. Supply the required recovery email template; live SMTP configuration is an operator dependency.
- `/diary` is private and read-only. Browse a selected local day using the saved account timezone and exact next-day boundaries. Show authoritative food rows and totals, without inventing historical targets. Clear stale data while a day reloads.
- `/data` is private. Explicitly export a bounded date range as tracking JSON, food CSV or weight CSV. JSON includes current goals, saved foods/recipes/preferences; dated rows are range-filtered. Chat, Google-grounded answers, billing and auth credentials are excluded. This is a tracking export, not a claim of complete legal account portability.
- Account guards capture and verify the mounted owner and pin the JWT. Export must fail after account change, database errors, oversize data or an incomplete page. CSV text is escaped against spreadsheet formula execution. Native temporary files are deleted after the share sheet closes.
- Keep existing branding and 44px controls. Include validation, progress, retry, empty states and keyboard support. No new diary mutations, AI calls or production deploys.

## Acceptance

Email recovery never changes a password before verified consent/code; failures never claim success; retries after a consumed code can continue a verified session safely. Date changes and account changes never show another account's results. Exports are complete within stated bounds or fail clearly. Browser checks cover all three pages at 375/768/1440px. Actual Gmail delivery and device sharing remain distinct from controlled tests.
