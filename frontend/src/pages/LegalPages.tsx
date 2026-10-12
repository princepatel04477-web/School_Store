import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { siteConfig } from '../siteConfig';
import './legal.css';

/*
 * Plain-language policy pages. They describe what the app actually does with
 * data today (phone + OTP sign-in, the school's student list, orders).
 * Keep them in step with the code, and have them reviewed by a lawyer before
 * launch: these are a working draft, not legal advice.
 */

const UPDATED = '10 October 2026';

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="legal container">
      <p className="legal-meta">Last updated {UPDATED}</p>
      <h1>{title}</h1>
      {children}
      <p className="legal-contact">
        Questions? Write to <a href={siteConfig.supportEmailHref}>{siteConfig.supportEmail}</a> or call{' '}
        <a href={siteConfig.supportPhoneHref}>{siteConfig.supportPhone}</a>.
      </p>
    </article>
  );
}

export function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        {siteConfig.name} sells school uniforms, shoes, stationery and ID cards on behalf of partner schools. This page
        explains what we collect, why, and what you can ask us to do with it. We follow the Digital Personal Data
        Protection Act, 2023.
      </p>

      <h2>What we collect</h2>
      <dl className="legal-list">
        <dt>Your mobile number</dt>
        <dd>Used to sign you in with a one-time code (OTP) and to send order updates. No password is stored for OTP accounts.</dd>
        <dt>Your child's school record</dt>
        <dd>
          Your child's school shares its student list with us: name, GR number, class, section, gender, date of
          birth and the parent mobile number on file. We use it only to show the right items and to fill in the ID
          card and order for you.
        </dd>
        <dt>Order details</dt>
        <dd>Items, sizes, the name printed on an ID card, and the delivery address or pickup choice.</dd>
        <dt>Payments</dt>
        <dd>Handled by our payment partner. We never see or store your card or UPI PIN.</dd>
      </dl>

      <h2>How your child is linked to you</h2>
      <p>
        When you sign in with a mobile number the school has on file, we show the children recorded against that
        number. If the school has no number for you, you can add your child with their GR number and date of birth.
        Nobody else can see your child's details through your account.
      </p>

      <h2>Who we share it with</h2>
      <p>
        Your child's school (to confirm orders and run the collection counter), the delivery partner (name, phone and
        address only) and the payment partner. We do not sell personal data or use it for advertising.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Order records are kept for 8 years because tax law requires it. Student records are kept while the school
        is a partner and removed within 90 days of the school asking us to, or of the student leaving the school.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask to see the data we hold about you or your child, correct it, or delete your account. Write to us
        from the email or phone on your account and we will reply within 30 days. Children's records can also be
        corrected through the school.
      </p>
    </LegalPage>
  );
}

export function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        By placing an order on {siteConfig.name} you agree to these terms. Browsing does not need an account.
      </p>

      <h2>Accounts</h2>
      <p>
        You sign in with your mobile number and a one-time code. Keep your phone secure: anyone who can read your
        SMS can sign in as you. Only add children you are the parent or guardian of.
      </p>

      <h2>Products and prices</h2>
      <p>
        Items are made to each school's approved specification. Prices include GST and are shown before you pay.
        Colours on screen can differ slightly from the fabric. If a price is clearly wrong we will tell you before
        dispatch and you can cancel for a full refund.
      </p>

      <h2>Personalised items</h2>
      <p>
        ID cards and anything printed with your child's name are made to order. Check the preview carefully: once
        production starts they cannot be cancelled, except for a fault on our side.
      </p>

      <h2>Delivery and pickup</h2>
      <p>
        We deliver to your address or to the school collection counter, whichever you choose at checkout. Dates
        shown are estimates; we will message you if an order is delayed.
      </p>

      <h2>Exchanges and refunds</h2>
      <p>
        See the <Link to="/refunds">Refund Policy</Link>.
      </p>

      <h2>Liability</h2>
      <p>
        Our responsibility for any order is limited to the amount you paid for it. Nothing here limits your rights
        under the Consumer Protection Act, 2019.
      </p>

      <h2>Disputes</h2>
      <p>These terms follow Indian law. Please contact us first; most problems are solved in a single call.</p>
    </LegalPage>
  );
}

export function RefundPage() {
  return (
    <LegalPage title="Refund Policy">
      <h2>Wrong size</h2>
      <p>
        Exchange unworn items with tags within 7 days of delivery, at home or at the school counter. The first size
        exchange on an order is free.
      </p>

      <h2>Damaged or wrong item</h2>
      <p>Tell us within 7 days with a photo. We replace it or refund it in full, including delivery.</p>

      <h2>Cancellations</h2>
      <p>
        Cancel any time before dispatch for a full refund. Personalised items (ID cards, name labels) cannot be
        cancelled once production starts.
      </p>

      <h2>How refunds are paid</h2>
      <p>To the original payment method, within 7 working days of approval.</p>
    </LegalPage>
  );
}
