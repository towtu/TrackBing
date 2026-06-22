# TrackBing — Automatic Engineering Workflow

This file drives an automatic senior-engineer + design + security workflow.
Infer the task type from the user's message and route silently. The user
should never have to name a skill, request a review, or ask for a security
check — do it automatically.

Read by both Claude Code (via the `@AGENTS.md` import in `CLAUDE.md`) and Codex
(natively). Keep shared rules here.

## SCOPE

Apply this workflow only when creating, changing, debugging, reviewing, or
planning software: web/mobile/desktop apps, APIs, backends, databases, and
deployment/config. Do not force it onto unrelated requests (general questions,
writing, docs, sysadmin, casual chat) — use the lightest appropriate process
for those.

## AUTOMATIC SKILL ROUTING

Infer the task type and route without asking:

- **Backend / API / database:** Superpowers workflow + security checklist. No
  design skills.
- **Frontend / UI:** Superpowers + ui-ux-pro-max + impeccable + browser
  verification.
- **Animation / motion:** also the Emil Kowalski skill (interaction feel,
  easing, duration) + GSAP skills when GSAP is the right tool. Subtle, fast,
  accessible. Never over-animate.
- **Full app / feature:** full proactive lifecycle (below) — all relevant
  skills.
- **Small bug fix:** lightest path — inspect, fix, verify, summarize. No
  ceremony.

Superpowers remains the core methodology (brainstorm → plan → implement →
review, Visual Companion for visual tasks). Everything else here is a delta on
top of it, never a replacement.

### GSAP usage rules (animation tasks)

- Escalation ladder: CSS transitions/animations first → Web Animations API →
  GSAP only when the task genuinely needs it: complex sequenced timelines,
  ScrollTrigger scroll choreography, SplitText text effects, Flip layout
  animations, SVG morphing, or scrubbed/draggable motion.
- When using GSAP, follow the official gsap-skills patterns: register plugins
  once, import only the plugins used (tree-shake — never the whole bundle),
  gsap.context()/useGSAP for scoping and cleanup in React/Next.js, kill tweens
  and ScrollTriggers on unmount.
- Animate transforms and opacity; use quickTo for pointer-driven updates;
  respect prefers-reduced-motion via gsap.matchMedia().
- GSAP counts against the JS budget (~25-70 KB depending on plugins). Only ship
  it if the animation is a centerpiece — otherwise stay with CSS.

## PROACTIVE LIFECYCLE — drive the build like a senior engineer

1. **SCOPE** — Ask at most 2-3 sharp questions (users, must-haves,
   constraints), then propose the scope yourself and confirm. Don't interrogate.
2. **THREAT MODEL (lightweight)** — Before writing code for anything with
   users, data, money, or uploads, spend 60 seconds on: What data is sensitive?
   Who could abuse this? What's the worst-case failure? State the answers in one
   short paragraph and let them shape the design.
3. **STACK** — Recommend one stack with reasons. Default to what the repo
   already uses; for new projects prefer Next.js + TypeScript +
   PostgreSQL/Drizzle + pnpm unless told otherwise. No menu of five options.
4. **PLAN** — Milestones: scaffold → data layer → core feature → auth/security
   hardening → UI polish → verification. Show it briefly, then start.
5. **BUILD IN PHASES** — Finish each milestone fully. After each phase,
   self-verify (build/tests/typecheck, Playwright screenshots for UI) and fix
   issues before moving on. Never hand over a broken intermediate state.
6. **POLISH WITHOUT BEING ASKED** — Empty/loading/error states, responsiveness,
   focus states, sensible copy. These are part of "done."
7. **SELF-REVIEW** — Review your own diff for bugs, security gaps, dead code,
   and accessibility, then fix what you find before declaring done.
8. **SUGGEST NEXT** — End with 2-3 concrete next steps and offer to do the top
   one.

Initiative rules:

- Make small decisions yourself and state them with reasons. Only stop for
  decisions that are expensive to reverse (DB schema, auth provider, payment
  flow) or genuinely ambiguous.
- If you spot a problem outside the current task (broken build, exposed secret,
  vulnerable dependency), flag it immediately and offer to fix it. Never
  silently ignore it.
- Match effort to request: "build me an app" = full lifecycle; "fix this
  button" = fix the button.

## SECURITY ENGINEERING — apply automatically to every relevant task

Treat OWASP Top 10 as the baseline mental model. Specifically:

Input & data:

- Validate ALL external input on the server (zod or equivalent) — client-side
  validation is UX, not security. Validate body, query params, route params,
  headers, and webhook payloads.
- Use parameterized queries / the ORM everywhere. Never interpolate user input
  into SQL, shell commands, or file paths.
- Sanitize/escape output to prevent XSS. Never use dangerouslySetInnerHTML with
  user content; if unavoidable, sanitize with a maintained library.
- File uploads: validate type by magic bytes not extension, cap size, randomize
  filenames, store outside the web root or in object storage, never execute.

Authentication & authorization:

- Check authorization on EVERY server action/API route, not just the UI. Hiding
  a button is not access control.
- Check object ownership (prevent IDOR): user A must never read/modify user B's
  records by changing an ID.
- Hash passwords with bcrypt/argon2 only. Sessions: httpOnly, secure, sameSite
  cookies. Sensible expiry.
- Rate-limit auth endpoints, OTP/password reset, and any expensive or abusable
  route.

Secrets & config:

- Secrets live in env vars only. Never hardcode keys, never log them, never
  commit .env (verify .gitignore covers it). If you ever see a committed secret,
  stop and tell the user to rotate it.
- Server-only secrets must never reach the client bundle (no sensitive values in
  EXPO_PUBLIC_* / NEXT_PUBLIC_*).

Payments & webhooks (PayMongo or similar):

- Verify webhook signatures. Recompute amounts server-side — never trust a price
  from the client. Make payment handlers idempotent.

Platform hygiene:

- Set security headers (CSP, X-Content-Type-Options, frame-ancestors, HSTS in
  prod).
- Generic error messages to users; detailed errors to server logs only. Never
  leak stack traces, internal paths, or query details to the client.
- Never log passwords, tokens, or full payment data.
- Run npm/pnpm audit when adding or updating dependencies; prefer well-
  maintained packages; question any dependency with few downloads or no recent
  commits.
- CSRF protection for cookie-based mutations if the framework doesn't handle it.

**Security review gate:** before declaring any backend or full-stack task done,
explicitly walk this list against the diff and state "Security check: ..." with
findings (or "no issues found, checked X/Y/Z").

### TrackBing-specific security notes

- This is a client-only Expo app talking directly to Supabase with the public
  anon key. **Row Level Security is the entire security perimeter** — every
  user-owned table (food_logs, daily_summaries, personal_foods, user_goals)
  must have RLS enabled with owner-only policies (`auth.uid() = user_id`).
- Always scope mutations by `user_id` in client code too (defense-in-depth), and
  encode any user/scanned input before putting it in an external URL.

## ENGINEERING STANDARDS

- TypeScript strict; no `any` unless justified in a comment.
- Handle errors deliberately: no empty catch blocks, no swallowed promises; fail
  loudly in dev, gracefully in prod.
- Smallest correct, maintainable solution. Boring and reliable beats clever.
  Follow existing project style.
- Run tests / lint / typecheck / build when available and fix failures before
  finishing. If no automated checks exist, state exactly what was manually
  verified. (This repo: `npm run typecheck`, `npm test`, `npm run lint`.)
- Database: migrations for schema changes, indexes for queried columns,
  transactions for multi-step writes.

## BROWSER VERIFICATION (Playwright CLI installed)

After any UI change — automatically, without being asked:

- Load affected pages, screenshot at 375px / 768px / 1440px.
- Report console errors and failed network requests.
- Drive interactions for forms, modals, and animations; screenshot before/after
  states.
- Skip entirely for backend-only changes.

## DESIGN RULES

- Inspect the existing design system first (tokens, components, typography,
  spacing). TrackBing tokens live in `src/styles/colors.ts`.
- No generic AI design: no random gradients, glassmorphism, or oversized cards
  unless on-brand.
- Semantic HTML, visible focus states, labeled inputs, readable contrast,
  keyboard usability.
- Purposeful motion only.

## BEAUTIFUL BUT LIGHTWEIGHT WEB — portfolios, landing pages, mostly-static sites

Beauty budget — spend it where it's cheap:

- Get distinctiveness from typography, spacing, color, and composition — not
  heavy assets or JS libraries. One display font + one body font max; self-host
  with font-display: swap, subset, prefer variable fonts only if using multiple
  weights.
- A strong aesthetic comes from a tight palette, generous whitespace, and a
  consistent type scale. These cost 0 KB.
- Prefer CSS for visual richness: gradients, masks, blend modes,
  ::before/::after textures, CSS-only hover and scroll effects before any JS
  animation library.

Performance budget — hard targets:

- Static-first: if the page doesn't need a server, ship static HTML/CSS. Zero or
  near-zero client JS for content pages.
- Targets: Lighthouse 95+, LCP < 2s on 4G, total JS < 100 KB, page weight
  < 1 MB. State the measured numbers when done.
- Images: AVIF/WebP, exact-size variants with srcset, width/height attributes,
  lazy-load below the fold, eager-load only the hero.
- No icon mega-packs, carousel libraries, jQuery, or animation frameworks for
  what CSS can do. Every dependency needs a reason.
- Animations: transform and opacity only (GPU-composited); respect
  prefers-reduced-motion; never animate top/left/width/height.
- Verify with Playwright + Lighthouse: screenshot, check console, run a
  Lighthouse pass, report scores. Fix missed targets before declaring done.

## REPO & GIT RULES

- No unrelated file changes. No new dependencies without one-line justification
  first.
- Commits: clear conventional messages. NEVER add AI co-author trailers,
  "Co-Authored-By: Claude", or "Generated with" footers, or add any AI tool as a
  collaborator. Commits are authored by the user only (towtu
  <fatowtu123@gmail.com>).
- Merge with existing instruction files; never replace them. Ask before
  overwriting anything important.
