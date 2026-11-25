import { Link } from 'react-router-dom';
import { siteConfig } from '../siteConfig';
import { useLang } from '../i18n';
import './headerFooter.css';

export function Footer() {
  const currentYear = new Date().getFullYear();
  const { t } = useLang();
  const hasContact = Boolean(siteConfig.supportPhone || siteConfig.whatsappHref || siteConfig.supportEmail);

  return (
    <footer className="site-footer">
      <div className="container footer-content">
        {/* Contact details, shown once they are filled in (see siteConfig) */}
        {hasContact && (
          <div className="footer-top">
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
          </div>
        )}

        {/* Two link columns: help and the company */}
        <div className="footer-grid footer-grid--two">
          <div className="footer-col">
            <h4 className="footer-title">{t('foot.help')}</h4>
            <ul className="footer-list">
              <li><Link to="/help?topic=size-guide">{t('product.sizeGuide')}</Link></li>
              <li><Link to="/help?topic=delivery">{t('co.delivery')}</Link></li>
              <li><Link to="/help?topic=returns">{t('product.exchangeTitle')}</Link></li>
              <li><Link to="/account">{t('co.placed.myOrders')}</Link></li>
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
