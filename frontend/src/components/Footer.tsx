import { Link } from 'react-router-dom';
import { siteConfig } from '../siteConfig';
import { Thread } from '../motion/Thread';
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
        <div className="footer-grid">
          {/* Col 1: Shop */}
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

          {/* Col 2: Help */}
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

          {/* Col 3: Company */}
          <div className="footer-col">
            <h4 className="footer-title">{t('foot.company')}</h4>
            <ul className="footer-list">
              <li><Link to="/about">{t('foot.about')}</Link></li>
              <li><Link to="/for-schools">{t('foot.forSchools')}</Link></li>
              <li><Link to="/contact">{t('foot.contact')}</Link></li>
            </ul>
          </div>

          {/* Col 4: Contact (only details that are filled in; see siteConfig) */}
          {hasContact && (
          <div className="footer-col footer-contact-col">
            <h4 className="footer-title">{t('foot.contact')}</h4>
            <p className="footer-hours">{siteConfig.hours}</p>
            <div className="footer-contact-links">
              {siteConfig.supportPhone && (
              <div>
                <span className="label">{t('foot.phone')}</span>
                <a href={siteConfig.supportPhoneHref} className="plain-link">
                  {siteConfig.supportPhone}
                </a>
              </div>
              )}
              {siteConfig.whatsappHref && (
              <div>
                <span className="label">WhatsApp</span>
                <a
                  href={siteConfig.whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="plain-link"
                >
                  {t('foot.message')}
                </a>
              </div>
              )}
              {siteConfig.supportEmail && (
              <div>
                <span className="label">{t('foot.email')}</span>
                <a href={siteConfig.supportEmailHref} className="plain-link">
                  {siteConfig.supportEmail}
                </a>
              </div>
              )}
            </div>
            {siteConfig.address && <p className="footer-address">{siteConfig.address}</p>}
          </div>
          )}
        </div>

        {/* Full-width Thread sitting above copyright */}
        <div className="footer-thread-wrap">
          <Thread />
        </div>

        {/* Bottom row */}
        <div className="footer-bottom-row">
          <p className="footer-copyright">
            © {currentYear} {siteConfig.businessName}. All rights reserved.
          </p>
          <div className="footer-legal-links">
            <Link to="/privacy">{t('co.privacy')}</Link>
            <span className="legal-dot">·</span>
            <Link to="/terms">{t('co.terms')}</Link>
            <span className="legal-dot">·</span>
            <Link to="/refunds">{t('co.refunds')}</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
