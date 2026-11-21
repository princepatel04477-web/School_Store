import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { EmeraldBand } from '../components/ui/EmeraldBand';
import { Button } from '../components/ui/Button';
import { AlertCircle, Check, SchoolBuilding, MessageCircle } from '../components/ui/icons';
import { siteConfig } from '../siteConfig';
import { schoolRequests } from '../api';
import { useLang } from '../i18n';
import './infoPages.css';

export function ContactPage() {
  const { t } = useLang();
  const [searchParams] = useSearchParams();
  const isRequestSchoolQuery = searchParams.get('reason') === 'request-school';

  const [parentName, setParentName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [cityName, setCityName] = useState('');
  const [stateName, setStateName] = useState('');
  const [gradeOrClass, setGradeOrClass] = useState('');
  const [remarks, setRemarks] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedData, setSubmittedData] = useState<{ school: string; city: string } | null>(null);

  const requestSectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isRequestSchoolQuery && requestSectionRef.current) {
      requestSectionRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isRequestSchoolQuery]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length !== 10) {
      setError(t('contact.parentPhoneHelp'));
      return;
    }
    if (!schoolName.trim()) {
      setError('Please provide the school name.');
      return;
    }
    if (!cityName.trim()) {
      setError('Please provide the city or town name.');
      return;
    }

    setLoading(true);
    try {
      await schoolRequests.requestSchool({
        parent_name: parentName.trim() || undefined,
        phone: cleanPhone,
        email: email.trim() || undefined,
        school_name: schoolName.trim(),
        city_name: cityName.trim(),
        state_name: stateName.trim() || undefined,
        grade_or_class: gradeOrClass.trim() || undefined,
        remarks: remarks.trim() || undefined,
      });

      setSubmittedData({
        school: schoolName.trim(),
        city: cityName.trim(),
      });
      setSchoolName('');
      setCityName('');
      setGradeOrClass('');
      setRemarks('');
      setError(null);
    } catch (err: any) {
      setError(err?.message || t('contact.error'));
    } finally {
      setLoading(false);
    }
  };

  const hasDirectChannels = Boolean(siteConfig.supportPhone || siteConfig.whatsappHref || siteConfig.supportEmail);

  return (
    <div className="info-page contact-page">
      <EmeraldBand eyebrow={siteConfig.name} title={t('contact.title')} withKids>
        <p className="em-lead">{siteConfig.tagline}</p>
      </EmeraldBand>

      <div className="container contact-container">
        {/* Support Channels & Verified Business Details */}
        <section className="contact-card support-info-card" aria-labelledby="support-channels-heading">
          <h2 id="support-channels-heading" className="contact-card-title">
            {t('contact.supportChannels')}
          </h2>

          <div className="support-channels-grid">
            <div className="support-channel-item">
              <span className="support-channel-label">{t('contact.hours')}</span>
              <p className="support-channel-value">{siteConfig.hours}</p>
            </div>

            <div className="support-channel-item">
              <span className="support-channel-label">{t('contact.company')}</span>
              <p className="support-channel-value">{siteConfig.businessName}</p>
            </div>

            {siteConfig.address && (
              <div className="support-channel-item">
                <span className="support-channel-label">{t('contact.address')}</span>
                <p className="support-channel-value">{siteConfig.address}</p>
              </div>
            )}

            {siteConfig.supportPhone && (
              <div className="support-channel-item">
                <span className="support-channel-label">{t('foot.phone')}</span>
                <a href={siteConfig.supportPhoneHref} className="support-channel-link">
                  {siteConfig.supportPhone}
                </a>
              </div>
            )}

            {siteConfig.whatsappHref && (
              <div className="support-channel-item">
                <span className="support-channel-label">WhatsApp</span>
                <a
                  href={siteConfig.whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="support-channel-link whatsapp-link"
                >
                  <MessageCircle width={16} height={16} />
                  <span>{t('foot.message')}</span>
                </a>
              </div>
            )}

            {siteConfig.supportEmail && (
              <div className="support-channel-item">
                <span className="support-channel-label">{t('foot.email')}</span>
                <a href={siteConfig.supportEmailHref} className="support-channel-link">
                  {siteConfig.supportEmail}
                </a>
              </div>
            )}
          </div>

          {!hasDirectChannels && (
            <div className="support-notice-banner" role="note">
              <p>{t('contact.phoneUnavailable')}</p>
            </div>
          )}
        </section>

        {/* Request Your School Form */}
        <section
          ref={requestSectionRef}
          className="contact-card request-school-card"
          aria-labelledby="request-school-heading"
        >
          <div className="request-school-header">
            <div className="request-school-icon-wrap" aria-hidden="true">
              <SchoolBuilding width={28} height={28} />
            </div>
            <div>
              <h2 id="request-school-heading" className="contact-card-title">
                {t('contact.requestSchoolTitle')}
              </h2>
              <p className="contact-card-subtitle">{t('contact.requestSchoolSubtitle')}</p>
            </div>
          </div>

          {submittedData ? (
            <div className="request-success-box" role="status" aria-live="polite">
              <div className="request-success-icon" aria-hidden="true">
                <Check width={24} height={24} strokeWidth={2.5} />
              </div>
              <h3>{t('contact.successTitle')}</h3>
              <p>
                {t('contact.successMessage', {
                  school: submittedData.school,
                  city: submittedData.city,
                })}
              </p>
              <div className="request-success-actions">
                <Button variant="primary" onClick={() => setSubmittedData(null)}>
                  {t('contact.anotherRequest')}
                </Button>
                <Link to="/shop" className="btn btn-outline">
                  {t('contact.backToShop')}
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="school-request-form" noValidate>
              {error && (
                <div className="form-error-banner" role="alert" aria-live="assertive">
                  <AlertCircle width={18} height={18} />
                  <span>{error}</span>
                </div>
              )}

              <div className="form-row form-row--two">
                <div className="form-field">
                  <label htmlFor="req-school-name" className="form-label">
                    {t('contact.schoolName')} *
                  </label>
                  <input
                    id="req-school-name"
                    type="text"
                    required
                    aria-required="true"
                    className="form-input"
                    placeholder="e.g. Delhi Public School"
                    value={schoolName}
                    onChange={(e) => setSchoolName(e.target.value)}
                  />
                </div>

                <div className="form-field">
                  <label htmlFor="req-city-name" className="form-label">
                    {t('contact.cityName')} *
                  </label>
                  <input
                    id="req-city-name"
                    type="text"
                    required
                    aria-required="true"
                    className="form-input"
                    placeholder="e.g. Surat, Ahmedabad"
                    value={cityName}
                    onChange={(e) => setCityName(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-row form-row--two">
                <div className="form-field">
                  <label htmlFor="req-state-name" className="form-label">
                    {t('contact.stateName')}
                  </label>
                  <input
                    id="req-state-name"
                    type="text"
                    className="form-input"
                    placeholder="e.g. Gujarat"
                    value={stateName}
                    onChange={(e) => setStateName(e.target.value)}
                  />
                </div>

                <div className="form-field">
                  <label htmlFor="req-grade" className="form-label">
                    {t('contact.gradeOrClass')}
                  </label>
                  <input
                    id="req-grade"
                    type="text"
                    className="form-input"
                    placeholder="e.g. Class 3, 5-A, Nursery"
                    value={gradeOrClass}
                    onChange={(e) => setGradeOrClass(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-row form-row--two">
                <div className="form-field">
                  <label htmlFor="req-parent-name" className="form-label">
                    {t('contact.parentName')}
                  </label>
                  <input
                    id="req-parent-name"
                    type="text"
                    className="form-input"
                    placeholder="Your name"
                    value={parentName}
                    onChange={(e) => setParentName(e.target.value)}
                  />
                </div>

                <div className="form-field">
                  <label htmlFor="req-phone" className="form-label">
                    {t('contact.parentPhone')} *
                  </label>
                  <input
                    id="req-phone"
                    type="tel"
                    inputMode="numeric"
                    required
                    aria-required="true"
                    maxLength={10}
                    className="form-input"
                    placeholder="10-digit mobile number"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  />
                  <span className="form-help">{t('contact.parentPhoneHelp')}</span>
                </div>
              </div>

              <div className="form-row">
                <div className="form-field">
                  <label htmlFor="req-email" className="form-label">
                    {t('contact.email')}
                  </label>
                  <input
                    id="req-email"
                    type="email"
                    className="form-input"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-field">
                  <label htmlFor="req-remarks" className="form-label">
                    {t('contact.remarks')}
                  </label>
                  <textarea
                    id="req-remarks"
                    rows={3}
                    className="form-input form-textarea"
                    placeholder="Any specific items (house t-shirt, blazer, tie, belt, shoes)"
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-actions">
                <Button type="submit" variant="primary" arrow disabled={loading} aria-busy={loading}>
                  {loading ? t('contact.submitting') : t('contact.submitRequest')}
                </Button>
              </div>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
