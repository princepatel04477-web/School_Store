import { CLASSES } from './classes';

export interface SeedSchool {
  id: string;
  name: string;
  city: string;
  board: 'CBSE' | 'ICSE' | 'State Board' | 'IB';
  code: string;
  slug: string;
  logoUrl?: string;
}

export interface SeedClass {
  id: string;
  schoolId: string;
  name: string;
  group: 'Pre-primary' | 'Primary' | 'Middle' | 'Secondary';
  sortOrder: number;
}

export interface SeedProduct {
  id: string;
  name: string;
  category: 'Uniform' | 'School Shoes' | 'Uniform Accessories' | 'Stationery' | 'ID Cards';
  categorySlug: string;
  descriptor: string;
  pricePaise: number;
  schoolId?: string;
  classId?: string;
  required?: boolean;
  gender?: 'boy' | 'girl' | 'unisex' | null;
  needs_review?: boolean;
  sizes: { id: string; size: string; inStock: boolean }[];
  description: string;
  fabricCare?: string;
  deliveryNotes?: string;
}

export const seedSchools: SeedSchool[] = [
  {
    id: 'sch-1',
    name: 'Delhi Public School, Sector 45',
    city: 'Gurugram',
    board: 'CBSE',
    code: 'DP',
    slug: 'dps-sec-45',
  },
  {
    id: 'sch-2',
    name: "The Mother's International School",
    city: 'New Delhi',
    board: 'CBSE',
    code: 'MI',
    slug: 'mothers-international',
  },
  {
    id: 'sch-3',
    name: 'The Cathedral & John Connon School',
    city: 'Mumbai',
    board: 'ICSE',
    code: 'CJ',
    slug: 'cathedral-john-connon',
  },
  {
    id: 'sch-4',
    name: 'National Public School, Indiranagar',
    city: 'Bengaluru',
    board: 'CBSE',
    code: 'NP',
    slug: 'nps-indiranagar',
  },
  {
    id: 'sch-5',
    name: 'Modern High School for Girls',
    city: 'Kolkata',
    board: 'ICSE',
    code: 'MH',
    slug: 'modern-high-school',
  },
  {
    id: 'sch-6',
    name: 'The Shri Ram School, Moulsari',
    city: 'Gurugram',
    board: 'ICSE',
    code: 'SR',
    slug: 'shri-ram-school',
  },
  {
    id: 'sch-7',
    name: 'Sanskriti School, Chanakyapuri',
    city: 'New Delhi',
    board: 'CBSE',
    code: 'SS',
    slug: 'sanskriti-school',
  },
  {
    id: 'sch-8',
    name: 'Vasant Valley School',
    city: 'New Delhi',
    board: 'CBSE',
    code: 'VV',
    slug: 'vasant-valley',
  },
];

export const seedClasses: SeedClass[] = CLASSES.map((c) => ({
  id: c.id,
  schoolId: 'sch-1',
  name: c.name,
  group: c.group,
  sortOrder: c.sortOrder,
}));

export const seedProducts: SeedProduct[] = [
  {
    id: 'prod-1',
    name: 'Half Sleeve Regular Oxford Shirt',
    category: 'Uniform',
    categorySlug: 'Uniform',
    descriptor: '65% Cotton, 35% Poly Blend',
    pricePaise: 65000,
    required: true,
    gender: 'unisex',
    needs_review: false,
    sizes: [
      { id: 'sz-28', size: '28', inStock: true },
      { id: 'sz-30', size: '30', inStock: true },
      { id: 'sz-32', size: '32', inStock: true },
      { id: 'sz-34', size: '34', inStock: true },
      { id: 'sz-36', size: '36', inStock: false },
    ],
    description: 'Crisp, easy-iron Oxford weave daily uniform shirt tailored with reinforced collar and school monogram pocket.',
    fabricCare: 'Machine wash warm (40°C). Tumble dry medium. Warm iron if needed. Do not bleach.',
    deliveryNotes: 'Dispatches within 48 hours. Direct to home or collection counter at school campus.',
  },
  {
    id: 'prod-2',
    name: 'Pleated School Skirt / Trousers',
    category: 'Uniform',
    categorySlug: 'Uniform',
    descriptor: 'Durable wrinkle-resistant twill',
    pricePaise: 82000,
    required: true,
    gender: 'girl',
    needs_review: false,
    sizes: [
      { id: 'sz-24', size: '24', inStock: true },
      { id: 'sz-26', size: '26', inStock: true },
      { id: 'sz-28', size: '28', inStock: true },
      { id: 'sz-30', size: '30', inStock: true },
    ],
    description: 'Smart tailored uniform bottoms featuring expandable waistband for growing children and deep slant pockets.',
    fabricCare: 'Wash dark colours separately. Line dry in shade.',
  },
  {
    id: 'prod-2b',
    name: 'School Uniform Trousers',
    category: 'Uniform',
    categorySlug: 'Uniform',
    descriptor: 'Durable wrinkle-resistant twill',
    pricePaise: 85000,
    required: true,
    gender: 'boy',
    needs_review: false,
    sizes: [
      { id: 'sz-26', size: '26', inStock: true },
      { id: 'sz-28', size: '28', inStock: true },
      { id: 'sz-30', size: '30', inStock: true },
      { id: 'sz-32', size: '32', inStock: true },
    ],
    description: 'Smart tailored boy uniform trousers featuring expandable waistband.',
    fabricCare: 'Wash dark colours separately. Line dry in shade.',
  },
  {
    id: 'prod-3',
    name: 'Winter Knit V-Neck Pullover',
    category: 'Uniform',
    categorySlug: 'Uniform',
    descriptor: 'Soft acrylic wool blend with contrast piping',
    pricePaise: 95000,
    required: false,
    gender: 'unisex',
    needs_review: false,
    sizes: [
      { id: 'sz-30', size: '30', inStock: true },
      { id: 'sz-32', size: '32', inStock: true },
      { id: 'sz-34', size: '34', inStock: true },
    ],
    description: 'Anti-pilling winter uniform sweater keeping students warm during morning assembly.',
  },
  {
    id: 'prod-4',
    name: 'Classic Black Lace-up Leather Shoes',
    category: 'School Shoes',
    categorySlug: 'School Shoes',
    descriptor: 'Breathable genuine leather with TPR sole',
    pricePaise: 115000,
    required: true,
    gender: 'unisex',
    needs_review: false,
    sizes: [
      { id: 'sz-1', size: '1', inStock: true },
      { id: 'sz-2', size: '2', inStock: true },
      { id: 'sz-3', size: '3', inStock: true },
      { id: 'sz-4', size: '4', inStock: true },
      { id: 'sz-5', size: '5', inStock: true },
    ],
    description: 'Approved daily black school shoes with padded insole and high-grip slip resistant outsoles.',
    fabricCare: 'Polish weekly with natural wax polish. Clean dry with damp cloth.',
  },
  {
    id: 'prod-5',
    name: 'All-White PE Activity Trainers',
    category: 'School Shoes',
    categorySlug: 'School Shoes',
    descriptor: 'Lightweight cushioned mesh running sole',
    pricePaise: 105000,
    required: false,
    gender: 'unisex',
    needs_review: false,
    sizes: [
      { id: 'sz-2', size: '2', inStock: true },
      { id: 'sz-3', size: '3', inStock: true },
      { id: 'sz-4', size: '4', inStock: true },
    ],
    description: 'Sports day and PE approved sneakers with breathable air-mesh and non-marking soles.',
  },
  {
    id: 'prod-6',
    name: 'Woven School Tie with Crest',
    category: 'Uniform Accessories',
    categorySlug: 'Uniform Accessories',
    descriptor: 'Micro-polyester jacquard weave',
    pricePaise: 22000,
    required: true,
    gender: 'unisex',
    needs_review: false,
    sizes: [
      { id: 'sz-std', size: 'Standard', inStock: true },
    ],
    description: 'Official house / school crest tie with pre-formed knot or standard tie option.',
  },
  {
    id: 'prod-7',
    name: 'Adjustable Elasticated Belt with Brass Buckle',
    category: 'Uniform Accessories',
    categorySlug: 'Uniform Accessories',
    descriptor: 'Strong woven strap with metal buckle',
    pricePaise: 18000,
    required: true,
    gender: 'unisex',
    needs_review: false,
    sizes: [
      { id: 'sz-free', size: 'Free Size', inStock: true },
    ],
    description: 'Heavy duty stretch belt with embossed school brass buckle.',
  },
  {
    id: 'prod-8',
    name: 'Cotton Rich Crew Socks (Pack of 3)',
    category: 'Uniform Accessories',
    categorySlug: 'Uniform Accessories',
    descriptor: '80% Combed Cotton, 20% Elastane',
    pricePaise: 32000,
    required: true,
    gender: 'unisex',
    needs_review: false,
    sizes: [
      { id: 'sz-s', size: 'Small (Size 1-3)', inStock: true },
      { id: 'sz-m', size: 'Medium (Size 4-6)', inStock: true },
    ],
    description: 'Seamless toe socks with reinforced heel and stay-up rib cuffs.',
  },
  {
    id: 'prod-9',
    name: 'Curriculum Notebook Bundle (Set of 6)',
    category: 'Stationery',
    categorySlug: 'Stationery',
    descriptor: '172 Pages, 70 GSM High Opacity Paper',
    pricePaise: 42000,
    required: true,
    gender: 'unisex',
    needs_review: false,
    sizes: [
      { id: 'sz-single', size: 'A4 Single Line', inStock: true },
      { id: 'sz-square', size: 'A4 Small Square', inStock: true },
    ],
    description: 'School syllabus standard bound notebooks with pre-printed student index and margins.',
  },
  {
    id: 'prod-10',
    name: 'Ergonomic Geometry Box & Instrument Set',
    category: 'Stationery',
    categorySlug: 'Stationery',
    descriptor: 'Die-cast compass with protective tin box',
    pricePaise: 19000,
    required: false,
    gender: 'unisex',
    needs_review: false,
    sizes: [
      { id: 'sz-tin', size: 'Complete Set', inStock: true },
    ],
    description: 'Precision self-centring compass, divider, 15cm ruler, and protractor.',
  },
  {
    id: 'prod-11',
    name: 'Smart RFID Student Identity Card with Lanyard',
    category: 'ID Cards',
    categorySlug: 'ID Cards',
    descriptor: 'Waterproof thermal laminated PVC, RFID chip',
    pricePaise: 15000,
    required: true,
    gender: 'unisex',
    needs_review: false,
    sizes: [
      { id: 'sz-id', size: 'Standard CR80', inStock: true },
    ],
    description: 'Official student RFID badge for attendance, library access, and gate security.',
  },
  {
    id: 'prod-12',
    name: 'Replacement Breakaway Safety Lanyard',
    category: 'ID Cards',
    categorySlug: 'ID Cards',
    descriptor: '20mm satin finish with quick-release snap',
    pricePaise: 7500,
    required: false,
    gender: 'unisex',
    needs_review: false,
    sizes: [
      { id: 'sz-lan', size: 'One Size', inStock: true },
    ],
    description: 'School printed satin lanyard with child-safe breakaway snap lock.',
  },
];
