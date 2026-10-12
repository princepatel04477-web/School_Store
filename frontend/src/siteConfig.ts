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
  businessName: 'SchoolStore Retail India Private Limited',
  address: ADDRESS,
  categories: [
    { label: 'Uniform', slug: 'Uniform' },
    { label: 'Shoes', slug: 'School Shoes' },
    { label: 'Accessories', slug: 'Uniform Accessories' },
    { label: 'Stationery', slug: 'Stationery' },
    { label: 'ID Cards', slug: 'ID Cards' },
  ],
};
