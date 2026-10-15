# data/

Local working files for product and customer data. **Everything in this
folder except this README is gitignored**: the repo is public, and these
files hold product exports, supplier details, prices and customer lists.
Nothing here is backed up by git, so keep your own copy of anything you can't
regenerate.

## Layout

| Where | What goes there |
|---|---|
| `data/` (top level) | Only files a script reads by name or picks up as "newest": the product export, LYUSA codes and supplier facts, the warehouse map, the Erply CDN URL map, the current QuickBooks create plan and fill-in sheet, the current pricing and measurement worklists. |
| `data/fix-logs/` | The plan and result record of each live change: `product-name-fixes-plan-*`, `product-name-fixes-applied-*-<date>`, `qb-product-create-applied-*`, `container-photos-uploaded-*`, `category-id-repair-backup-*`. |
| `data/<topic>/` | Older per-job folders (`bows-pack-spec-fix/`, `plush-erply-import/`, `woo-tier-review/`, ...). Scripts write into these by fixed path, so leave them where they are. |
| `data/images/` | Local photo dumps and image mapping CSVs. |
| `data/archive/<date>/` | Superseded copies. Nothing reads them. Safe to delete once you're sure. |

## After running a fix script

Plan and fix scripts (`scripts/plan-*.ts`, `scripts/fix-product-names.ts`,
`scripts/upload-container-photos.ts`, ...) write their output to the top of
`data/`. Once a change has been applied:

1. Move its plan CSV and dated `-applied-` CSV into `fix-logs/`.
2. Delete the generic `product-name-fixes-dryrun.csv` / `product-name-fixes-applied.csv`
   (each run overwrites them).
3. When a dated worklist or plan is replaced by a newer one, move the old one
   into `archive/<today>/`.
