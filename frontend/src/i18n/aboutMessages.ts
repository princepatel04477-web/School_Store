import { useCallback } from 'react';
import { useLang, type Lang } from './index';

/**
 * Words on the "Our story" page (/about), in English, Gujarati and Hindi.
 * Kept apart from messages.ts so the page can ship on its own.
 * A native speaker should read the Gujarati and Hindi columns before launch.
 */
type Entry = Record<Lang, string>;

export const aboutMessages = {
  'about.pageTitle': {
    en: 'Our story | SchoolStore by Colorbenz',
    gu: 'અમારી કહાણી | SchoolStore by Colorbenz',
    hi: 'हमारी कहानी | SchoolStore by Colorbenz',
  },
  'about.metaDescription': {
    en: 'Why Colorbenz built SchoolStore: your school uniform and accessories, ordered from home and delivered to your door.',
    gu: 'Colorbenz એ SchoolStore કેમ બનાવ્યું: તમારી સ્કૂલનો યુનિફોર્મ અને એક્સેસરીઝ ઘરેથી ઓર્ડર કરો, અમે ઘરે પહોંચાડીએ.',
    hi: 'Colorbenz ने SchoolStore क्यों बनाया: अपने स्कूल की यूनिफॉर्म और एक्सेसरीज़ घर से ऑर्डर करें, हम घर तक पहुँचाते हैं।',
  },
  'about.eyebrow': { en: 'BY COLORBENZ', gu: 'COLORBENZ દ્વારા', hi: 'COLORBENZ द्वारा' },
  'about.titleLead': { en: 'Our', gu: 'અમારી', hi: 'हमारी' },
  'about.titleAccent': { en: 'story', gu: 'કહાણી', hi: 'कहानी' },
  'about.sub': {
    en: 'We fixed what frustrated every parent.',
    gu: 'દરેક માતા-પિતાને જે તકલીફ હતી, તે અમે દૂર કરી.',
    hi: 'हर माता-पिता की परेशानी हमने दूर की।',
  },
  'about.kidsAlt': {
    en: 'Two smiling children in school uniform',
    gu: 'સ્કૂલ યુનિફોર્મમાં બે હસતાં બાળકો',
    hi: 'स्कूल यूनिफॉर्म में दो मुस्कुराते बच्चे',
  },
  'about.problemEyebrow': { en: 'THE PROBLEM', gu: 'સમસ્યા', hi: 'समस्या' },
  'about.problemTitle': {
    en: 'School shopping is a struggle',
    gu: 'સ્કૂલની ખરીદી એક મુશ્કેલી છે',
    hi: 'स्कूल की खरीदारी एक मुश्किल काम है',
  },
  'about.timeTitle': { en: 'Parents waste time', gu: 'માતા-પિતાનો સમય બગડે છે', hi: 'माता-पिता का समय बर्बाद होता है' },
  'about.timeBody': {
    en: 'Hours go into travelling from shop to shop for one school list.',
    gu: 'એક સ્કૂલ લિસ્ટ માટે દુકાને-દુકાને ફરવામાં કલાકો જાય છે.',
    hi: 'एक स्कूल लिस्ट के लिए दुकान-दुकान घूमने में घंटों लग जाते हैं।',
  },
  'about.stockTitle': { en: 'Stock unavailable', gu: 'સ્ટોક મળતો નથી', hi: 'स्टॉक नहीं मिलता' },
  'about.stockBody': {
    en: 'After all that running, the size or item you need is not there.',
    gu: 'આટલું ફર્યા પછી પણ જોઈતી સાઇઝ કે વસ્તુ મળતી નથી.',
    hi: 'इतना घूमने के बाद भी ज़रूरी साइज़ या सामान नहीं मिलता।',
  },
  'about.pivot': {
    en: 'So Colorbenz built SchoolStore',
    gu: 'એટલે Colorbenz એ SchoolStore બનાવ્યું',
    hi: 'इसलिए Colorbenz ने SchoolStore बनाया',
  },
  'about.fixEyebrow': { en: 'THE FIX', gu: 'ઉકેલ', hi: 'समाधान' },
  'about.fixTitle': {
    en: "Your school's uniform, delivered to your door.",
    gu: 'તમારી સ્કૂલનો યુનિફોર્મ, તમારા ઘર સુધી.',
    hi: 'आपके स्कूल की यूनिफॉर्म, आपके दरवाज़े तक।',
  },
  'about.fixHome': {
    en: 'Order in a few taps, right from home.',
    gu: 'ઘરે બેઠા, થોડા જ ટેપમાં ઓર્ડર કરો.',
    hi: 'घर बैठे, बस कुछ टैप में ऑर्डर करें।',
  },
  'about.fixList': {
    en: "Everything on your school's list, in one place.",
    gu: 'તમારી સ્કૂલ લિસ્ટની બધી વસ્તુઓ, એક જ જગ્યાએ.',
    hi: 'आपकी स्कूल लिस्ट का सब सामान, एक ही जगह।',
  },
  'about.badgeTitle': { en: 'First time in India', gu: 'ભારતમાં પહેલી વાર', hi: 'भारत में पहली बार' },
  'about.badgeBody': {
    en: 'School uniform and accessories, delivered.',
    gu: 'સ્કૂલ યુનિફોર્મ અને એક્સેસરીઝ, ઘર સુધી.',
    hi: 'स्कूल यूनिफॉर्म और एक्सेसरीज़, घर तक।',
  },
  'about.schoolsTitle': {
    en: 'Schools we deliver to',
    gu: 'આ સ્કૂલો માટે અમે ડિલિવરી કરીએ છીએ',
    hi: 'इन स्कूलों के लिए हम डिलीवरी करते हैं',
  },
  'about.schoolsRegion': {
    en: 'Schools we deliver to. Scroll sideways to see more.',
    gu: 'અમે જે સ્કૂલો માટે ડિલિવરી કરીએ છીએ. વધુ જોવા માટે બાજુમાં સ્ક્રોલ કરો.',
    hi: 'जिन स्कूलों के लिए हम डिलीवरी करते हैं। और देखने के लिए बगल में स्क्रॉल करें।',
  },
  'about.swipe': { en: 'Swipe', gu: 'સ્વાઇપ કરો', hi: 'स्वाइप करें' },
  'about.prev': { en: 'Previous schools', gu: 'પાછલી સ્કૂલો', hi: 'पिछले स्कूल' },
  'about.next': { en: 'More schools', gu: 'વધુ સ્કૂલો', hi: 'और स्कूल' },
  'about.cta': { en: 'Find your school', gu: 'તમારી સ્કૂલ શોધો', hi: 'अपना स्कूल खोजें' },
} satisfies Record<string, Entry>;

export type AboutKey = keyof typeof aboutMessages;

export function useAboutText() {
  const { lang } = useLang();
  const t = useCallback((key: AboutKey) => aboutMessages[key][lang] || aboutMessages[key].en, [lang]);
  return { lang, t };
}
