import { Product } from '@/lib/types'
import ProductCard from './ProductCard'
import EmptyState from './EmptyState'

interface ProductGridProps {
  products: Product[]
  didYouMean?: { q: string; href: string } | null
}

export default function ProductGrid({ products, didYouMean }: ProductGridProps) {
  if (products.length === 0) {
    return <EmptyState didYouMean={didYouMean} />
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-3 xl:grid-cols-4">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  )
}
