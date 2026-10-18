# TrackBing documentation

## Start with these

| Need | Guide |
| --- | --- |
| Understand folders and local generated files | [Project structure](project-structure.md) |
| Configure the current DeepSeek assistant and label reader | [DeepSeek Bee](deepseek-label-photos.md) |
| See what is verified and what still blocks launch | [Launch readiness](launch/2026-10-18-release-readiness.md) |
| Continue the verified Vercel/GitHub setup | [Hosting connection](launch/2026-10-19-release-connection.md) |
| Run CI, prepare releases, or recover a failed release | [CI and releases](CI_CD.md) |
| Understand remaining dependency findings | [Dependency review](dependency-remediation.md) |
| Recover the historically exposed USDA key | [Credential review](launch/2026-10-19-secret-history-review.md) |
| Inspect web bundle savings and measurement limits | [Web performance](launch/2026-10-19-web-performance.md) |

## Feature guides

| Feature | Guide |
| --- | --- |
| Bee food creation and recipes | [Food and recipes](bee-food-recipes.md) |
| Portions, preparation corrections and source priority | [Food corrections](bee-food-corrections.md) |
| Account recovery, diary and export | [Account and diary](account-and-diary-ux.md) |
| Mascot poses, motion and reduced-motion preference | [Bee motion](bee-mascot-motion.md) |
| Sign-in and saved-food interaction checks | [Authentication UX](auth-ui-polish.md) |
| Cookbook interaction checks | [Cookbook UX](cookbook-ui-polish.md) |
| Public routes, policy drafts and web metadata | [Public web](launch/public-web.md) |

## Historical context

The original [Gemini deployment guide](bee-gemini-deployment.md), September
[implementation report](launch/2026-09-27-implementation-report.md),
[initial audit](launch/2026-09-27-initial-audit.md), and
[product brief](../TrackBing_Gemini_Search_Migration_README.md) explain earlier
decisions. The current DeepSeek and launch guides above supersede provider/setup
details. Retain those records; they are not evidence of a current deployment.

`superpowers/specs/` contains design history; `superpowers/plans/` contains task
records. They remain in their established workflow location. Current continuation:
[19 October hardening and cleanup](superpowers/plans/2026-10-19-hardening-and-cleanup.md).

Credentials belong in ignored local environment files or provider/GitHub secret
stores. Test reports, screenshots, schema rehearsals and generated bundles belong
under ignored `output/`; never publish private schema snapshots or credentials.
