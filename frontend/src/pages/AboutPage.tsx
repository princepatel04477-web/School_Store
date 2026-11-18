import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { OurStorySection } from '../components/home/OurStorySection';
import { useAboutText } from '../i18n/aboutMessages';
import { SHOP_LINK } from '../siteConfig';
import './about.css';

export { MIN_SLIDER_SCHOOLS } from '../components/home/OurStorySection';

function usePageMeta(title: string, description: string) {
  useEffect(() => {
    const previousTitle = document.title;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const created = !meta;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'description';
      document.head.appendChild(meta);
    }
    const previousDescription = meta.content;
    document.title = title;
    meta.content = description;
    return () => {
      document.title = previousTitle;
      if (!meta) return;
      if (created) meta.remove();
      else meta.content = previousDescription;
    };
  }, [title, description]);
}

function Sparkle({ className }: { className: string }) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 24 24" width="16" height="16">
      <path d="M12 0C13 8 16 11 24 12C16 13 13 16 12 24C11 16 8 13 0 12C8 11 11 8 12 0Z" />
    </svg>
  );
}

/** /about: the emerald story banner, then the same story section that home shows below its hero. */
export function AboutPage() {
  const { t } = useAboutText();
  const navigate = useNavigate();

  usePageMeta(t('about.pageTitle'), t('about.metaDescription'));

  return (
    <div className="about-page">
      <section className="about-hero">
        <div className="about-hero-circles" aria-hidden="true">
          <span className="about-circle about-circle--outer" />
          <span className="about-circle about-circle--inner" />
        </div>
        <div className="about-container about-hero-grid">
          <div className="about-hero-copy">
            <p className="about-eyebrow about-eyebrow--light">{t('about.eyebrow')}</p>
            <h1 className="about-h1">
              {t('about.titleLead')} <span className="about-accent">{t('about.titleAccent')}</span>
            </h1>
            <p className="about-hero-sub">{t('about.sub')}</p>
          </div>
          <div className="about-hero-art">
            <Sparkle className="about-sparkle about-sparkle--a" />
            <Sparkle className="about-sparkle about-sparkle--b" />
            <picture>
              <source srcSet="/brand/kids-uniform.clean.avif" type="image/avif" />
              <source srcSet="/brand/kids-uniform.clean.webp" type="image/webp" />
              <img
                className="about-kids"
                src="/brand/kids-uniform.clean.png"
                alt={t('about.kidsAlt')}
                width={600}
                height={880}
                decoding="async"
              />
            </picture>
          </div>
        </div>
      </section>

      <OurStorySection onFindSchool={() => navigate(SHOP_LINK)} />
    </div>
  );
}

export default AboutPage;
