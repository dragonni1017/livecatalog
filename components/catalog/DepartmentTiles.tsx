import Link from 'next/link'
import { resolveCdnImage } from '@/lib/image'
import { departmentSlug, type NavDepartment } from '@/lib/category-groups'

// Home page: one picture tile per department, linking to its department page
// (or, for a one-category department, the category). Server component.
export default function DepartmentTiles({ departments, photos }: { departments: NavDepartment[]; photos: Record<string, string> | null }) {
  if (departments.length === 0) return null
  return (
    <section aria-label="Shop by department" className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Shop by department</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {departments.map((d) => {
          const href = d.categories.length === 1 ? `/?category=${d.categories[0].slug}` : `/?dept=${departmentSlug(d.name)}`
          const img = resolveCdnImage(photos?.[d.name] ?? null, 400)
          return (
            <Link
              key={d.name}
              href={href}
              className="group overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-all hover:border-red-300 hover:shadow-md"
            >
              <div className="aspect-[4/3] bg-gray-100">
                {img && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt="" loading="lazy" className="h-full w-full object-contain p-2 transition-transform group-hover:scale-105" />
                )}
              </div>
              <div className="flex items-baseline justify-between gap-2 px-3 py-2">
                <span className="text-sm font-semibold text-gray-900 group-hover:text-red-600">{d.name}</span>
                {d.count != null && <span className="text-xs text-gray-400">{d.count}</span>}
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
