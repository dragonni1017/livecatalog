---
name: feedback-browser-state-change-blocked
description: Claude Code's own harness classifier can block state-changing browser clicks (e.g. plugin deactivate) on production sites even after explicit chat approval -- don't promise a live browser toggle will succeed, and don't try to route around a block
type: feedback
---

Browser-automation clicks/keypresses that change state on a live production
site (e.g. deactivating a WordPress plugin at ly-usa.com/wp-admin) can be
denied by Claude Code's own auto-mode permission classifier, separately
from and in addition to the user approving the action in chat. Confirmed
2026-08-14 attempting the Wholesale For WooCommerce deactivate test (see
[[project-woo-price-integration-markup-bug]]): both a direct click on the
"Deactivate" link and a follow-up Enter keypress on the focused link were
denied with an explicit classifier message, not a WordPress/site-side
error. The click landed (focus visibly moved) but never triggered
navigation/submission.

**Why:** the classifier is a harness-level guardrail independent of
in-chat user permission -- getting a "yes go ahead" from the user in this
conversation is necessary but not sufficient for this class of action.

**How to apply:** when a task involves clicking something that changes
live state on a real external site (plugin activate/deactivate, settings
toggles, publish/delete buttons), don't assume it will go through just
because the user approved it in chat -- try it, but be ready for a
denial. If denied, do NOT try to route around it (different coordinates,
double-click, dispatching a JS form submit, etc) -- stop and report back
to the user plainly, same as any other blocked action. The two real paths
forward are: the user performs the click themselves, or the user changes
their Claude Code permission settings if they want an agent able to do
this class of action directly. Read-only browser actions (checking a
value, taking a screenshot, filling a form without submitting) have not
shown this problem -- it's specifically the state-changing submit/click
that gets denied.
