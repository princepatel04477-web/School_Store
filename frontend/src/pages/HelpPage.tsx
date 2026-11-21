import { useState, useMemo, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { EmeraldBand } from '../components/ui/EmeraldBand';
import { ChevronDown, MessageCircle, SchoolBuilding } from '../components/ui/icons';
import { siteConfig } from '../siteConfig';
import { useLang, type MessageKey } from '../i18n';
import './infoPages.css';

export type HelpTopic = 'all' | 'size-guide' | 'delivery' | 'payment' | 'returns' | 'request-school';

interface FaqItem {
  id: string;
  topic: Exclude<HelpTopic, 'all'>;
  qKey: MessageKey;
  aKey: MessageKey;
}

const FAQ_ITEMS: FaqItem[] = [
  // Size & Fit
  { id: 'size-how', topic: 'size-guide', qKey: 'help.q.sizeHow', aKey: 'help.a.sizeHow' },
  { id: 'size-between', topic: 'size-guide', qKey: 'help.q.sizeBetween', aKey: 'help.a.sizeBetween' },
  { id: 'shoes-size', topic: 'size-guide', qKey: 'help.q.shoes', aKey: 'help.a.shoes' },

  // Delivery & Pickup
  { id: 'delivery-modes', topic: 'delivery', qKey: 'help.q.deliveryModes', aKey: 'help.a.deliveryModes' },
  { id: 'delivery-time', topic: 'delivery', qKey: 'help.q.deliveryTime', aKey: 'help.a.deliveryTime' },
  { id: 'delivery-charges', topic: 'delivery', qKey: 'help.q.deliveryCharges', aKey: 'help.a.deliveryCharges' },

  // Payment & COD
  { id: 'payment-methods', topic: 'payment', qKey: 'help.q.payments', aKey: 'help.a.payments' },
  { id: 'payment-failed', topic: 'payment', qKey: 'help.q.paymentFailed', aKey: 'help.a.paymentFailed' },

  // Exchanges & Refunds
  { id: 'exchange-rules', topic: 'returns', qKey: 'help.q.exchange', aKey: 'help.a.exchange' },
  { id: 'return-conditions', topic: 'returns', qKey: 'help.q.returnCondition', aKey: 'help.a.returnCondition' },

  // Request School
  { id: 'request-school-how', topic: 'request-school', qKey: 'help.q.requestSchoolHow', aKey: 'help.a.requestSchoolHow' },
];

export function HelpPage({ initialTopic = 'all' }: { initialTopic?: HelpTopic }) {
  const { t } = useLang();
  const [searchParams, setSearchParams] = useSearchParams();

  const queryTopic = (searchParams.get('topic') as HelpTopic) || initialTopic;
  const [activeTopic, setActiveTopic] = useState<HelpTopic>(queryTopic);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.get('topic')) {
      setActiveTopic(searchParams.get('topic') as HelpTopic);
    } else if (initialTopic !== 'all') {
      setActiveTopic(initialTopic);
    }
  }, [searchParams, initialTopic]);

  const handleTopicSelect = (topic: HelpTopic) => {
    setActiveTopic(topic);
    if (topic === 'all') {
      searchParams.delete('topic');
      setSearchParams(searchParams, { replace: true });
    } else {
      setSearchParams({ topic }, { replace: true });
    }
  };

  const filteredFaqs = useMemo(() => {
    if (activeTopic === 'all') return FAQ_ITEMS;
    return FAQ_ITEMS.filter((item) => item.topic === activeTopic);
  }, [activeTopic]);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const topics: { id: HelpTopic; labelKey: MessageKey }[] = [
    { id: 'all', labelKey: 'help.allTopics' },
    { id: 'size-guide', labelKey: 'help.sizeGuide' },
    { id: 'delivery', labelKey: 'help.delivery' },
    { id: 'payment', labelKey: 'help.payment' },
    { id: 'returns', labelKey: 'help.returns' },
    { id: 'request-school', labelKey: 'help.requestSchool' },
  ];

  return (
    <div className="info-page help-page">
      <EmeraldBand eyebrow={siteConfig.name} title={t('help.title')} withKids>
        <p className="em-lead">{t('help.subtitle')}</p>
      </EmeraldBand>

      <div className="container help-container">
        {/* Topic filter chips */}
        <section aria-label="Help topics navigation">
          <div className="help-topic-chips" role="tablist">
            {topics.map((top) => (
              <button
                key={top.id}
                role="tab"
                aria-selected={activeTopic === top.id}
                className={`help-topic-chip ${activeTopic === top.id ? 'active' : ''}`}
                onClick={() => handleTopicSelect(top.id)}
              >
                {t(top.labelKey)}
              </button>
            ))}
          </div>
        </section>

        {/* FAQs Accordion */}
        <section className="help-card" aria-labelledby="faqs-heading">
          <h2 id="faqs-heading" className="help-card-title">
            {activeTopic === 'all'
              ? t('help.allTopics')
              : t(topics.find((tp) => tp.id === activeTopic)?.labelKey || 'help.title')}
          </h2>

          <div className="help-faq-list" role="region" aria-label="Frequently Asked Questions">
            {filteredFaqs.map((faq) => {
              const isExpanded = expandedId === faq.id;
              const contentId = `faq-answer-${faq.id}`;
              const buttonId = `faq-btn-${faq.id}`;

              return (
                <div key={faq.id} className="help-faq-item">
                  <button
                    id={buttonId}
                    type="button"
                    className="help-faq-question"
                    aria-expanded={isExpanded}
                    aria-controls={contentId}
                    onClick={() => toggleExpand(faq.id)}
                  >
                    <span>{t(faq.qKey)}</span>
                    <span className="help-faq-icon" aria-hidden="true">
                      <ChevronDown width={18} height={18} strokeWidth={2} />
                    </span>
                  </button>

                  {isExpanded && (
                    <div
                      id={contentId}
                      role="region"
                      aria-labelledby={buttonId}
                      className="help-faq-answer"
                    >
                      <p>{t(faq.aKey)}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Support CTA Footer */}
        <section className="help-contact-cta" aria-labelledby="need-help-heading">
          <div className="help-cta-text">
            <h3 id="need-help-heading">{t('help.stillQuestions')}</h3>
            <p>{t('help.contactSupport')}</p>
          </div>
          <div className="help-cta-actions">
            <Link to="/contact" className="btn btn-primary">
              <MessageCircle width={16} height={16} />
              <span>{t('help.goToContact')}</span>
            </Link>
            <Link to="/contact?reason=request-school" className="btn btn-outline">
              <SchoolBuilding width={16} height={16} />
              <span>{t('help.requestSchoolButton')}</span>
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
