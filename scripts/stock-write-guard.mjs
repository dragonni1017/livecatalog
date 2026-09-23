// stock-write-guard.mjs
//
// Shared refusal for scripts that add or remove stock in Erply directly.
//
// /admin/receiving is now the way a container is received, and it runs five
// checks a script has none of: shipments.status, per-line applied_at, a
// unique file_hash, the container-already-applied guard, and the
// already-registered-in-Erply guard. It also leaves a shipments row behind,
// which is what lets the next receipt see what this one did.
//
// A script leaves nothing. That is not theoretical: on 2026-09-03
// add-stock-from-arrival-lists.mjs stocked container EGSU9509206, and when
// the same arrival list was received through the screen on 2026-09-23 the app
// had no way to know -- 5,200 pieces went in twice and were only found by
// reconciling Erply's own registration documents by hand
// (docs/memory/project-receiving-to-catalog-20260923.md).
//
// These scripts still exist because they are the record of how that stock got
// there, and because a genuine one-off will happen again. So this refuses by
// default rather than deleting them, and the override is deliberately
// awkward to type.

const OVERRIDE = '--i-know-receiving-supersedes-this'

export function assertStockWriteAllowed(scriptName, { what } = {}) {
  if (process.argv.includes(OVERRIDE)) {
    console.warn(
      `\n!! ${scriptName} is writing stock to Erply directly, bypassing /admin/receiving.\n` +
      `!! Nothing here checks whether this stock was already added. Verify afterwards with:\n` +
      `!!   node scripts/writeoff-double-added-stock.mjs --old=<docs> --new=<docs>\n`,
    )
    return
  }

  console.error(
    `\n${scriptName} refuses to run.\n\n` +
    `${what ?? 'This script writes stock to Erply directly'}, which /admin/receiving now does\n` +
    `with five duplicate checks and an audit trail that this script cannot match.\n` +
    `A script leaves no shipments row, so a later receipt of the same container\n` +
    `cannot tell it already happened -- that is exactly how 5,200 pieces were\n` +
    `added twice on 2026-09-23.\n\n` +
    `Receive the container at /admin/receiving instead.\n\n` +
    `If you genuinely need this script (a correction, a container that cannot be\n` +
    `staged), re-run it with ${OVERRIDE}\n` +
    `and reconcile afterwards.\n`,
  )
  process.exit(1)
}
