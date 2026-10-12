import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import type { SeedProduct, SeedSchool } from './seedData';

/**
 * The public store's real data: schools and their approved items, read from the
 * server's public catalogue (no sign-in needed). Shapes match the screens'
 * existing types so the pages did not have to change.
 */

export interface StoreSchool extends SeedSchool {
  cityId?: string;
  homeDelivery: boolean;
  schoolPickup: boolean;
}

export interface StoreProduct extends SeedProduct {
  imageUrl?: string;
  /** Needs a photo or details the parent can't give here (ID card, photo notebook). */
  needsDetails: boolean;
}

type PublicSchool = {
  id: string;
  name: string;
  code: string;
  city?: string | null;
  city_name?: string;
  home_delivery?: boolean;
  school_pickup?: boolean;
};

type PublicVariant = { id: string; size: string; stock_status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | null };
type CustomisationField = { required?: boolean };
type PublicProduct = {
  id: string;
  name: string;
  description: string;
  category: string;
  gender: string | null;
  price: number;
  thumbnail: string | null;
  customisation_schema: CustomisationField[] | { fields?: CustomisationField[] } | null;
  variants: PublicVariant[];
};
type Page<T> = { next: string | null; results: T[] };

const slugify = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

function needsDetails(schema: PublicProduct['customisation_schema']): boolean {
  const fields = Array.isArray(schema) ? schema : schema?.fields ?? [];
  return fields.some((field) => field?.required);
}

/** The card's one-line descriptor: the first sentence, if it is short. */
function descriptor(description: string): string {
  const first = description.split(/(?<=[.!?])\s/)[0]?.trim() ?? '';
  return first.length <= 60 ? first.replace(/\.$/, '') : '';
}

function toSchool(school: PublicSchool): StoreSchool {
  return {
    id: school.id,
    name: school.name,
    code: school.code,
    slug: slugify(school.name),
    city: school.city_name || '',
    cityId: school.city || undefined,
    homeDelivery: school.home_delivery ?? true,
    schoolPickup: school.school_pickup ?? true,
  };
}

function toProduct(product: PublicProduct): StoreProduct {
  const gender = product.gender?.toLowerCase();
  return {
    id: product.id,
    name: product.name,
    category: product.category as SeedProduct['category'],
    categorySlug: slugify(product.category),
    descriptor: descriptor(product.description),
    description: product.description,
    pricePaise: Math.round(product.price * 100),
    gender: gender === 'boy' || gender === 'girl' || gender === 'unisex' ? gender : null,
    // No stock record for this city means the server would refuse the order.
    sizes: product.variants.map((variant) => ({
      id: variant.id,
      size: variant.size,
      inStock: variant.stock_status === 'IN_STOCK' || variant.stock_status === 'LOW_STOCK',
    })),
    imageUrl: product.thumbnail || undefined,
    needsDetails: needsDetails(product.customisation_schema),
  };
}

export function useStoreSchools() {
  return useQuery({
    queryKey: ['store', 'schools'],
    queryFn: async () => (await api<PublicSchool[]>('/public/schools/')).map(toSchool),
    staleTime: 10 * 60 * 1000,
  });
}

/** Every approved item for one school, class and boy/girl, across all pages. */
export function useStoreProducts(schoolId?: string, className?: string, gender?: 'boy' | 'girl' | null) {
  return useQuery({
    queryKey: ['store', 'products', schoolId, className, gender],
    enabled: Boolean(schoolId && className && gender),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const params = new URLSearchParams({ school: schoolId!, class: className!, gender: gender! });
      const products: PublicProduct[] = [];
      let path: string | null = `/public/products/?${params}`;
      // The list is paged; a school's class list is small, so a few pages at most.
      for (let pages = 0; path && pages < 20; pages++) {
        const page: Page<PublicProduct> = await api<Page<PublicProduct>>(path);
        products.push(...page.results);
        path = page.next ? page.next.slice(page.next.indexOf('/public/')) : null;
      }
      return products.map(toProduct);
    },
  });
}
