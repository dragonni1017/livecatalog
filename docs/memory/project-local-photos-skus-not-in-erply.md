---
name: project-local-photos-skus-not-in-erply
description: 2026-10-01: ~240 SKUs have photos on disk but exist in NEITHER Erply nor the catalog; zero local photos are waiting on an upload step — the blocker is product creation
type: project
---

Checked 2026-10-01 (read-only): 3,730 images under `C:/Users/Dragon/Downloads`,
matched with `lib/photo-matching.ts` rules against all 3,313 catalog SKUs and
all 3,168 Erply products (every status).

- Only **2** files belong to a catalog product with no image (`F288091-P.jpg`).
  Exact-SKU photos for every other imageless product: none on disk.
- **~240 distinct SKU-named files' SKUs exist in neither Erply nor the catalog**
  (spot-checked by `getProducts code=` / `code2=` / name search; control SKU
  found). List: `data/local-photo-skus-not-in-erply-20261001.tsv`.
  Ranges: F287652–F288209, G333172–G333236, K229489–K229588, P273647–P273860,
  S162781–S162828, T642153–T642299, 3D8013xx.
- Folders map to containers that were **never run through `/admin/receiving`**
  (`EGSU1118334Photos`, `EGHU9765009Photos`, `CAAU7499734Photos`, …; only 7
  containers are in `shipments`, all applied 2026-09-23).
- **`02_Photos\6-16-26pics` and `6-17-26pics` are SAMPLES** (Dragon,
  2026-10-01). Ignore them and never create products from them. They're
  already removed from the .tsv, which leaves 179 SKUs. `02_Photos\images` (75 SKUs) is NOT June:
  its file dates run 2025-09 to 2026-08. Those are **real products** (Dragon,
  2026-10-01), so they need products created. It has no container association, so
  receiving can't create them from an arrival list.
- `P273840` exists in Erply only as `P273840-80CM`. Size/colour-suffixed SKUs
  mean a bare-base photo name won't match. Don't auto-map a base onto a variant.

**Why:** "photos haven't reached Cloudinary" looked like an upload gap. It's
actually a product-creation gap. Building more upload tooling won't move these.
**How to apply:** these photos need products created first, via receiving with
that container's arrival list, or by hand. Then the `/admin/cleanup` folder
drop matches them. Re-run the check before acting, since containers get received over time.
