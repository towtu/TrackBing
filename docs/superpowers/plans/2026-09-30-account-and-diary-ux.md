# Account and diary UX Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline to implement this plan task-by-task. The user has authorized autonomous implementation and reviewable commits.

**Goal:** Add email password recovery, local-date diary browsing and private tracking downloads.

**Architecture:** Supabase Auth owns password verification. Existing owner-protected tables remain authoritative; pinned account clients perform bounded reads. Expo shares temporary files on native; browsers download blobs.

**Tech Stack:** Expo 54, React Native, strict TypeScript, Supabase, Vitest, Playwright; SDK-compatible expo-file-system/expo-sharing for native file delivery.

### 1. Recovery

- [x] Write `src/lib/passwordRecovery.test.ts`: invalid input never calls Auth; invalid OTP never updates password; verified retry does not consume OTP twice; dispose prevents late verification from starting a write; duplicate submits rejected; post-write signout failure reports success with warning.
- [x] Run `npx vitest run src/lib/passwordRecovery.test.ts` and observe missing implementation failure.
- [x] Implement `src/lib/passwordRecovery.ts`, isolated client in `src/lib/recoveryClient.ts`, `src/screens/RecoveryScreen.tsx` and `app/recover.tsx`. Add sign-in/Profile links, noindex route metadata and `supabase/templates/recovery.html`.
- [x] Rerun targeted tests and `npm run typecheck`.

### 2. Private reads and downloads

- [x] Write `src/lib/trackingData.test.ts`: Manila/DST boundaries, invalid/range dates, owner filters, full pagination, cap failure, database failure, account-switch fencing, CSV quoting/formula protection and exclusion of extra fields.
- [x] Run `npx vitest run src/lib/trackingData.test.ts` and observe missing implementation failure.
- [x] Implement `src/lib/trackingData.ts`, `src/lib/saveTrackingFile.ts`, `/diary` and `/data` screens. Use `getAccountDay`, `dayBounds` and `createFoodAccountGuard`; add Dashboard/Profile navigation. Add route security tests.
- [x] Run targeted tests, app typecheck and lint; repair failures before UI verification.

### 3. Verification and handoff

- [x] Extend controlled browser checks with recovery send/invalid code/success, historical empty/populated days and actual downloaded CSV/JSON. Capture 375/768/1440 screenshots; inspect console and network failures.
- [x] Run `npm test`, app/function typechecks, lint, real database invariants, web and native exports, audit and bundle secret check. Clearly separate mocks and local Auth from Gmail/device checks.
- [x] Document exact email/SMTP setup, retention/download risks and verified results. Review diff for privacy, authentication, owner scope, invalid input, races and unsafe output. Local cleanup exposed an existing cascade bug: add the forward-only trigger fix and real PostgreSQL red/green regression; no feature tables are added.
- [x] Publish conventional commits authored by towtu to the feature branch, prepare an apply-ready review patch and update draft PR notes without merging or deploying. Preserve `codex.diff`. The Git push succeeded after execution permissions changed; the remote branch head was verified.
