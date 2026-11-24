import { isCategoryLive } from './data/liveCategories';

/**
 * The one way into the shop. Every "Shop", "Find your school" and category link
 * (Uniform, Shoes, Tie, belt & socks) goes here, so nobody lands mid-flow on a
 * different page; the parent picks their state, city and school first.
 */
export const SHOP_LINK = '/shop';

// Real contact details. Leave a field empty until it is real: empty ones are hidden
// everywhere, and online ordering stays closed until WHATSAPP_NUMBER is set
// (a made-up number would send parents' calls and orders to a stranger).
const SUPPORT_PHONE: string = ''; // as parents should see it, e.g. '+91 98250 12345'
const WHATSAPP_NUMBER: string = ''; // country code + number, digits only, e.g. '919825012345'
const SUPPORT_EMAIL: string = '';
const ADDRESS: string = '';

export const siteConfig = {
  name: 'SchoolStore',
  mark: 'S',
  logoText: 'SchoolStore',
  tagline: 'Everything your school asks for. One order.',
  supportPhone: SUPPORT_PHONE,
  supportPhoneHref: SUPPORT_PHONE ? `tel:${SUPPORT_PHONE.replace(/[^\d+]/g, '')}` : '',
  whatsappNumber: WHATSAPP_NUMBER,
  whatsappHref: WHATSAPP_NUMBER ? `https://wa.me/${WHATSAPP_NUMBER}` : '',
  supportEmail: SUPPORT_EMAIL,
  supportEmailHref: SUPPORT_EMAIL ? `mailto:${SUPPORT_EMAIL}` : '',
  hours: 'Mon – Sat, 9:00 AM – 6:00 PM IST',
  businessName: 'School Store Retail by Colorbenz',
  address: ADDRESS,
  categories: [
    { label: 'Uniform', slug: 'Uniform' },
    { label: 'Accessories', slug: 'Uniform Accessories' },
    { label: 'Stationery', slug: 'Stationery' },
    { label: 'ID Cards', slug: 'ID Cards' },
  ].filter((category) => isCategoryLive(category.slug)),
};
