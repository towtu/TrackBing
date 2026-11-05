# Private Bee backend rollout

The user requested working Bee chat on localhost. Keep the public web/payment
release disabled and the deployed legacy ai-food/usda-search pair unchanged.

1. Compare live schema and aggregate validation counts with the additive chain;
   rehearse against a schema-only copy in disposable PostgreSQL 16.
2. Test and add explicit service-granted, seven-day private evaluation access.
   No subscription/payment fabrication: all normal Basic/Plus/Pro limits stay
   unchanged. Limit evaluation to 20 turns, six searches, three insights and
   bounded token reservations; expired/revoked grants lose access.
3. Apply migrations with recorded history, deploy only new Bee endpoints, and
   enable evaluation only for the verified account supplied by the user.
4. Check authenticated live chat, anonymous denial, old endpoint versions, and
   unchanged diary/targets. Never write a user's diary as an automated test.
5. Rebuild local web, run relevant checks, update setup and reviewable PR.

Sensitive data: owner chat, preferences, measurements and diary. The worst
failure is cross-account disclosure or an unreviewed/duplicate diary write.
Keep server JWT validation, owner-scoped reads, service-only draft creation,
atomic confirmed writes, finite evaluation budgets and provider privacy gates.

Verification must distinguish mocked/local database tests, actual provider
calls and public production release checks. Server flags/grant revocation are
the rollback; never drop tables or delete user history to roll back.
