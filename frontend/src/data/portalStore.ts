// Persistent portal store for Schools and Uniforms
// Ensures changes made in /portal persist across browser sessions and sync to app & storefront

export interface PortalUniformItem {
  id: string;
  schoolName: string;
  name: string;
  category: string;
  gender: 'boy' | 'girl' | 'unisex';
  classes: string;
  price: number;
  costPrice: number;
  photo: string;
  inStock: boolean;
  sizes: string[];
  createdAt?: string;
}

export interface PortalSchool {
  id: string;
  name: string;
  code: string;
  city: string;
  state?: string;
  logoUrl?: string;
  homeDelivery: boolean;
  schoolPickup: boolean;
  active?: boolean;
}

const UNIFORMS_KEY = 'schoolstore_portal_uniforms_v1';
const SCHOOLS_KEY = 'schoolstore_portal_schools_v1';
export const PORTAL_EVENT = 'schoolstore_portal_update';

export const INITIAL_SCHOOLS: PortalSchool[] = [
  { id: 'sch-kv', name: 'Kendriya Vidyalaya', code: 'KV', city: 'Surat', state: 'Gujarat', homeDelivery: true, schoolPickup: true, logoUrl: '/brand/schools/kv.svg' },
  { id: 'sch-dps', name: 'Delhi Public School Surat', code: 'DPS', city: 'Surat', state: 'Gujarat', homeDelivery: true, schoolPickup: true, logoUrl: '/brand/schools/dps.svg' },
  { id: 'sch-fountain', name: 'Fountainhead School Surat', code: 'FS', city: 'Surat', state: 'Gujarat', homeDelivery: true, schoolPickup: true, logoUrl: '/brand/schools/fountainhead.svg' },
  { id: 'sch-udgam', name: 'Udgam School for Children', code: 'UDG', city: 'Ahmedabad', state: 'Gujarat', homeDelivery: true, schoolPickup: true, logoUrl: '/brand/schools/udgam.svg' },
];

export const INITIAL_UNIFORMS: PortalUniformItem[] = [
  {
    id: 'u-kv-1',
    schoolName: 'Kendriya Vidyalaya',
    name: 'KV Red House PT T-Shirt (Class 1-5)',
    category: 'PT Kit',
    gender: 'unisex',
    classes: 'Class 1-5',
    price: 320,
    costPrice: 192,
    photo: '/products/kv-house-tshirt-red.webp',
    inStock: true,
    sizes: ['20', '22', '24', '26', '28', '30'],
  },
  {
    id: 'u-kv-2',
    schoolName: 'Kendriya Vidyalaya',
    name: 'KV Red House PT T-Shirt (Class 6-12)',
    category: 'PT Kit',
    gender: 'unisex',
    classes: 'Class 6-12',
    price: 390,
    costPrice: 234,
    photo: '/products/kv-house-tshirt-red.webp',
    inStock: true,
    sizes: ['28', '30', '32', '34', '36', '38', '40', '42'],
  },
  {
    id: 'u-kv-3',
    schoolName: 'Kendriya Vidyalaya',
    name: 'KV Boys Summer Shirt (Half Sleeve)',
    category: 'Uniform',
    gender: 'boy',
    classes: 'Class 1-5',
    price: 380,
    costPrice: 220,
    photo: '/products/kv-boys-1-5-shirt-summer.webp',
    inStock: true,
    sizes: ['22', '24', '26', '28', '30'],
  },
  {
    id: 'u-kv-4',
    schoolName: 'Kendriya Vidyalaya',
    name: 'KV Boys Navy Shorts',
    category: 'Uniform',
    gender: 'boy',
    classes: 'Class 1-5',
    price: 340,
    costPrice: 200,
    photo: '/products/kv-boys-1-5-shorts.webp',
    inStock: true,
    sizes: ['20', '22', '24', '26', '28'],
  },
  {
    id: 'u-kv-5',
    schoolName: 'Kendriya Vidyalaya',
    name: 'KV Navy PT Track Pants',
    category: 'PT Kit',
    gender: 'unisex',
    classes: 'Class 1-12',
    price: 420,
    costPrice: 250,
    photo: '/products/kv-boys-6-12-trousers.webp',
    inStock: true,
    sizes: ['24', '26', '28', '30', '32', '34', '36', '38'],
  },
  {
    id: 'u-dps-1',
    schoolName: 'Delhi Public School Surat',
    name: 'DPS Boys Short Sleeve Polo Shirt',
    category: 'Uniform',
    gender: 'boy',
    classes: 'Class 1-12',
    price: 450,
    costPrice: 270,
    photo: '/products/uniform-dps-shirt.webp',
    inStock: true,
    sizes: ['26', '28', '30', '32', '34', '36'],
  },
];

function notify() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PORTAL_EVENT));
  }
}

// Schools
export function getPortalSchools(): PortalSchool[] {
  if (typeof window === 'undefined') return INITIAL_SCHOOLS;
  try {
    const raw = localStorage.getItem(SCHOOLS_KEY);
    if (!raw) {
      localStorage.setItem(SCHOOLS_KEY, JSON.stringify(INITIAL_SCHOOLS));
      return INITIAL_SCHOOLS;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : INITIAL_SCHOOLS;
  } catch {
    return INITIAL_SCHOOLS;
  }
}

export function savePortalSchool(school: PortalSchool) {
  const current = getPortalSchools();
  const index = current.findIndex((s) => s.id === school.id);
  let updated: PortalSchool[];
  if (index >= 0) {
    updated = [...current];
    updated[index] = { ...updated[index], ...school };
  } else {
    updated = [school, ...current];
  }
  localStorage.setItem(SCHOOLS_KEY, JSON.stringify(updated));
  notify();
  return updated;
}

export function deletePortalSchool(schoolId: string) {
  const current = getPortalSchools();
  const updated = current.filter((s) => s.id !== schoolId);
  localStorage.setItem(SCHOOLS_KEY, JSON.stringify(updated));
  notify();
  return updated;
}

// Uniforms
export function getPortalUniforms(): PortalUniformItem[] {
  if (typeof window === 'undefined') return INITIAL_UNIFORMS;
  try {
    const raw = localStorage.getItem(UNIFORMS_KEY);
    if (!raw) {
      localStorage.setItem(UNIFORMS_KEY, JSON.stringify(INITIAL_UNIFORMS));
      return INITIAL_UNIFORMS;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : INITIAL_UNIFORMS;
  } catch {
    return INITIAL_UNIFORMS;
  }
}

export function savePortalUniform(item: PortalUniformItem) {
  const current = getPortalUniforms();
  const index = current.findIndex((u) => u.id === item.id);
  let updated: PortalUniformItem[];
  if (index >= 0) {
    updated = [...current];
    updated[index] = { ...updated[index], ...item };
  } else {
    updated = [item, ...current];
  }
  localStorage.setItem(UNIFORMS_KEY, JSON.stringify(updated));
  notify();
  return updated;
}

export function deletePortalUniform(itemId: string) {
  const current = getPortalUniforms();
  const updated = current.filter((u) => u.id !== itemId);
  localStorage.setItem(UNIFORMS_KEY, JSON.stringify(updated));
  notify();
  return updated;
}

export function togglePortalUniformStock(itemId: string) {
  const current = getPortalUniforms();
  const updated = current.map((u) => (u.id === itemId ? { ...u, inStock: !u.inStock } : u));
  localStorage.setItem(UNIFORMS_KEY, JSON.stringify(updated));
  notify();
  return updated;
}

/**
 * Reads any image file (PNG, JPG, SVG, WebP) from the user's computer and
 * generates a lightweight, web-optimized Data URL for instant rendering & storage.
 */
export function readFileAsDataUrl(file: File, maxDimension = 900): Promise<string> {
  return new Promise((resolve, reject) => {
    // If it's SVG, read as text/dataURL directly
    if (file.type.includes('svg')) {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const src = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL(file.type || 'image/jpeg', 0.88));
            return;
          }
        }
        resolve(src);
      };
      img.onerror = () => resolve(src);
      img.src = src;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
