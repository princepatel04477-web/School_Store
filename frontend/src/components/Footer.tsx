import { Link } from 'react-router-dom';
import { siteConfig } from '../siteConfig';
import { Thread } from '../motion/Thread';
import './headerFooter.css';

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="container footer-content">
        <div className="footer-grid">
          {/* Col 1: Shop */}
          <div className="footer-col">
            <h4 className="footer-title">Shop</h4>
            <ul className="footer-list">
              {siteConfig.categories.map((cat) => (
                <li key={cat.slug}>
                  <Link to={`/shop?cat=${encodeURIComponent(cat.slug)}`}>{cat.label}</Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Col 2: Help */}
          <div className="footer-col">
            <h4 className="footer-title">Help</h4>
            <ul className="footer-list">
              <li><Link to="/help?topic=size-guide">Size guide</Link></li>
              <li><Link to="/help?topic=delivery">Delivery</Link></li>
              <li><Link to="/help?topic=returns">Returns & exchanges</Link></li>
              <li><Link to="/help?topic=track">Track order</Link></li>
              <li><Link to="/help?topic=faq">Frequently asked questions</Link></li>
            </ul>
          </div>

          {/* Col 3: Company */}
          <div className="footer-col">
            <h4 className="footer-title">Company</h4>
            <ul className="footer-list">
              <li><Link to="/about">About SchoolStore</Link></li>
              <li><Link to="/for-schools">For partner schools</Link></li>
              <li><Link to="/contact">Contact us</Link></li>
            </ul>
          </div>

          {/* Col 4: Contact */}
          <div className="footer-col footer-contact-col">
            <h4 className="footer-title">Contact</h4>
            <p className="footer-hours">{siteConfig.hours}</p>
            <div className="footer-contact-links">
              <div>
                <span className="label">Phone</span>
                <a href={siteConfig.supportPhoneHref} className="plain-link">
                  {siteConfig.supportPhone}
                </a>
              </div>
              <div>
                <span className="label">WhatsApp</span>
                <a
                  href={siteConfig.whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="plain-link"
                >
                  Message support
                </a>
              </div>
              <div>
                <span className="label">Email</span>
                <a href={siteConfig.supportEmailHref} className="plain-link">
                  {siteConfig.supportEmail}
                </a>
              </div>
            </div>
            <p className="footer-address">{siteConfig.address}</p>
          </div>
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
            <Link to="/privacy">Privacy Policy</Link>
            <span className="legal-dot">·</span>
            <Link to="/terms">Terms of Service</Link>
            <span className="legal-dot">·</span>
            <Link to="/refunds">Refund Policy</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
