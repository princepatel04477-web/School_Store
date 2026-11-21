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
  state?: string;
  homeDelivery: boolean;
  schoolPickup: boolean;
}

export interface StoreProduct extends SeedProduct {
  /** The small photo for cards and lists. */
  imageUrl?: string;
  /** The full-size photo for the item's own page. */
  heroUrl?: string;
  /** What the photo shows, read out by screen readers. */
  imageAlt?: string;
  /** Needs a photo or details the parent can't give here (ID card, photo notebook). */
  needsDetails: boolean;
  /** Made for this school (its own shirt, tie, belt…), as opposed to a general item. */
  official: boolean;
}

type PublicSchool = {
  id: string;
  name: string;
  code: string;
  city?: string | null;
  city_name?: string;
  state_name?: string;
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
  school: string | null;
  price: number;
  thumbnail: string | null;
  image?: string | null;
  image_alt?: string | null;
  customisation_schema: CustomisationField[] | { fields?: CustomisationField[] } | null;
  material_composition?: string | null;
  care_instructions?: string | null;
  fabric_care?: string | null;
  variants: PublicVariant[];
  required?: boolean;
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
    state: school.state_name || '',
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
    heroUrl: product.image || undefined,
    imageAlt: product.image_alt || undefined,
    needsDetails: needsDetails(product.customisation_schema),
    official: Boolean(product.school),
    required: Boolean(product.required),
    materialComposition: product.material_composition || undefined,
    careInstructions: product.care_instructions || undefined,
    fabricCare:
      product.fabric_care ||
      (product.material_composition && product.care_instructions
        ? `${product.material_composition}. ${product.care_instructions}`
        : product.material_composition || product.care_instructions) ||
      undefined,
  };
}

export function useStoreSchools() {
  return useQuery({
    queryKey: ['store', 'schools'],
    queryFn: async () => (await api<PublicSchool[]>('/public/schools/')).map(toSchool),
    staleTime: 10 * 60 * 1000,
  });
}

export interface StoreDeliveredSchool {
  id: string;
  name: string;
  logo_url: string;
}

export function useStoreDeliveredSchools() {
  return useQuery({
    queryKey: ['store', 'schools', 'delivered'],
    queryFn: () => api<StoreDeliveredSchool[]>('/public/schools/delivered/'),
    staleTime: 10 * 60 * 1000,
  });
}

// ---------- State, then city, then branch ----------

export interface StoreState {
  name: string;
  cityCount: number;
}

export interface StoreCity {
  id: string;
  name: string;
  state: string;
  branchCount: number;
}

/** One campus. Its school owns the uniform list; its city decides stock. */
export interface StoreBranch {
  id: string;
  name: string;
  address: string;
  pincode: string;
  /** Government UDISE+ code; empty for campuses not on UDISE+ (standalone preschools). */
  udise_code: string;
  photo: string | null;
  school: { id: string; name: string; code: string };
}

const withSchool = (path: string, schoolId?: string) =>
  schoolId ? `${path}${path.includes('?') ? '&' : '?'}school=${encodeURIComponent(schoolId)}` : path;

/** States with at least one open branch (of one school, when given). */
export function useStoreStates(schoolId?: string) {
  return useQuery({
    queryKey: ['store', 'states', schoolId ?? ''],
    staleTime: 10 * 60 * 1000,
    queryFn: async () =>
      (await api<{ name: string; city_count: number }[]>(withSchool('/public/states/', schoolId))).map(
        (s): StoreState => ({ name: s.name, cityCount: s.city_count })
      ),
  });
}

export function useStoreCities(state?: string, schoolId?: string) {
  return useQuery({
    queryKey: ['store', 'cities', state, schoolId ?? ''],
    enabled: Boolean(state),
    staleTime: 10 * 60 * 1000,
    queryFn: async () =>
      (
        await api<{ id: string; name: string; state: string; branch_count: number }[]>(
          withSchool(`/public/cities/?state=${encodeURIComponent(state!)}`, schoolId)
        )
      ).map((c): StoreCity => ({ id: c.id, name: c.name, state: c.state, branchCount: c.branch_count })),
  });
}

export function useStoreBranches(cityId?: string, schoolId?: string) {
  return useQuery({
    queryKey: ['store', 'branches', cityId, schoolId ?? ''],
    enabled: Boolean(cityId),
    staleTime: 10 * 60 * 1000,
    queryFn: () => api<StoreBranch[]>(withSchool(`/public/cities/${cityId}/branches/`, schoolId)),
  });
}

/** Every approved item for one school, class and boy/girl, across all pages. */
export function useStoreProducts(
  schoolId?: string,
  className?: string,
  gender?: 'boy' | 'girl' | null,
  /** The branch's city, for stock. Without it the server uses the school's own city. */
  cityId?: string,
  branchId?: string,
  season?: string
) {
  return useQuery({
    queryKey: ['store', 'products', schoolId, className, gender, cityId ?? '', branchId ?? '', season ?? ''],
    enabled: Boolean(schoolId && className && gender),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const params = new URLSearchParams({ school: schoolId!, class: className!, gender: gender! });
      if (cityId) params.set('city', cityId);
      if (branchId) params.set('branch', branchId);
      if (season) params.set('season', season);
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
