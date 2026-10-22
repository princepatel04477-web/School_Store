import { Link } from 'react-router-dom';
import { siteConfig } from '../siteConfig';
import { useLang } from '../i18n';
import { categoryLabel } from '../i18n/labels';
import './headerFooter.css';

export function Footer() {
  const currentYear = new Date().getFullYear();
  const { t } = useLang();
  const hasContact = Boolean(siteConfig.supportPhone || siteConfig.whatsappHref || siteConfig.supportEmail);

  return (
    <footer className="site-footer">
      <div className="container footer-content">
        {/* Top: the brand, and the contact details when they are filled in (see siteConfig) */}
        <div className="footer-top">
          <Link to="/" className="footer-brand" aria-label={`${siteConfig.name} Home`}>
            <span className="brand-mark">{siteConfig.mark}</span>
            <span className="footer-brand-name">{siteConfig.logoText}</span>
          </Link>

          {hasContact && (
            <div className="footer-contact">
              <h4 className="footer-title">{t('foot.contact')}</h4>
              <p className="footer-hours">{siteConfig.hours}</p>
              <div className="footer-contact-links">
                {siteConfig.supportPhone && (
                  <div>
                    <span className="footer-label">{t('foot.phone')}</span>
                    <a href={siteConfig.supportPhoneHref} className="footer-contact-value">
                      {siteConfig.supportPhone}
                    </a>
                  </div>
                )}
                {siteConfig.whatsappHref && (
                  <div>
                    <span className="footer-label">WhatsApp</span>
                    <a
                      href={siteConfig.whatsappHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="footer-contact-value"
                    >
                      {t('foot.message')}
                    </a>
                  </div>
                )}
                {siteConfig.supportEmail && (
                  <div>
                    <span className="footer-label">{t('foot.email')}</span>
                    <a href={siteConfig.supportEmailHref} className="footer-contact-value">
                      {siteConfig.supportEmail}
                    </a>
                  </div>
                )}
              </div>
              {siteConfig.address && <p className="footer-address">{siteConfig.address}</p>}
            </div>
          )}
        </div>

        {/* Link columns, divided by hairlines */}
        <div className="footer-grid">
          <div className="footer-col">
            <h4 className="footer-title">{t('foot.shop')}</h4>
            <ul className="footer-list">
              {siteConfig.categories.map((cat) => (
                <li key={cat.slug}>
                  <Link to={`/shop?cat=${encodeURIComponent(cat.slug)}`}>{categoryLabel(cat.slug, t)}</Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="footer-col">
            <h4 className="footer-title">{t('foot.help')}</h4>
            <ul className="footer-list">
              <li><Link to="/help?topic=size-guide">{t('product.sizeGuide')}</Link></li>
              <li><Link to="/help?topic=delivery">{t('co.delivery')}</Link></li>
              <li><Link to="/help?topic=returns">{t('product.exchangeTitle')}</Link></li>
              <li><Link to="/parent/orders">{t('co.placed.myOrders')}</Link></li>
              <li><Link to="/help?topic=faq">{t('foot.faq')}</Link></li>
            </ul>
          </div>

          <div className="footer-col">
            <h4 className="footer-title">{t('foot.company')}</h4>
            <ul className="footer-list">
              <li><Link to="/about">{t('foot.about')}</Link></li>
              <li><Link to="/for-schools">{t('foot.forSchools')}</Link></li>
              <li><Link to="/contact">{t('foot.contact')}</Link></li>
            </ul>
          </div>
        </div>
      </div>

      {/* The wordmark, set across the full width. The brand link above carries the name. */}
      <div className="footer-wordmark container" aria-hidden="true">
        <svg viewBox="0 0 1000 170" preserveAspectRatio="xMidYMid meet" focusable="false">
          <text x="0" y="150" textLength="1000" lengthAdjust="spacingAndGlyphs">
            {siteConfig.logoText}
          </text>
        </svg>
      </div>

      <div className="container">
        <div className="footer-bottom-row">
          <p className="footer-copyright">
            © {currentYear} {siteConfig.businessName}. All rights reserved.
          </p>
          <div className="footer-legal-links">
            <Link to="/privacy">{t('co.privacy')}</Link>
            <Link to="/terms">{t('co.terms')}</Link>
            <Link to="/refunds">{t('co.refunds')}</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
