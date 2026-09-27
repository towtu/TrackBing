# Initial launch audit — 27 September 2026

Baseline: `0a48da4`, branch `feat/bee-conversation`. Untracked user brief and `codex.diff` preserved. These are pre-change findings, not final completion claims.

| # | Item | Initial status | Evidence / dependency |
| --- | --- | --- | --- |
| 1 | Privacy | missing | No public route or operator/contact configuration |
| 2 | Terms | missing | No public route; legal decisions unknown |
| 3 | Secrets/RLS | partial | Server-only Bee keys and real ownership tests; whole-product audit needed |
| 4 | HTTPS | dependent | No confirmed production domain; blanket Vercel rewrite exists |
| 5 | Storage consent | missing | Essential Supabase storage exists; no optional analytics integration found |
| 6 | Metadata | missing | Root renders auth/loading; no +html or public head configuration |
| 7 | Social preview | missing | No configured site origin or social asset |
| 8 | Favicon | partial | App config references branded icon; export/browser inspection needed |
| 9 | Sitemap/robots | missing | No public-only generators |
| 10 | Alt/accessibility | partial | Bee and several profile inputs labeled; global audit needed |
| 11 | Image compression | missing | Bee PNGs total about 2 MB; optimization not measured |
| 12 | Performance | partial | Web exports pass; 8.39 MB entry bundle, no production URL/metrics |
| 13 | Contrast | partial | Shared palette exists; actual ratios not recorded |
| 14 | Responsive/native | partial | Bee/Add/Create web tested at three widths; no device runtime yet |
| 15 | 404 | missing | No custom route; blanket rewrite returns index for unknown paths |
| 16 | Links | partial | Safe Bee citations; whole export/direct-route checks needed |
| 17 | Validation | partial | Bee runtime validation and body limits; global forms/database audit needed |
| 18 | Spam | partial | Atomic AI quotas; Auth CAPTCHA/settings and USDA abuse limits need audit |
| 19 | Analytics | missing | No optional tracking implementation or approved service configuration |
| 20 | Primary CTA | partial | Existing signup/sign-in and diary actions; full first-use review needed |
