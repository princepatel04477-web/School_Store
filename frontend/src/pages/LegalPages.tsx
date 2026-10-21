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

const UPDATED = '18 October 2026';

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="legal container">
      <p className="legal-meta">Last updated {UPDATED}</p>
      <h1>{title}</h1>
      {children}
      {(siteConfig.supportEmail || siteConfig.supportPhone) && (
        <p className="legal-contact">
          Questions?{' '}
          {siteConfig.supportEmail && (
            <>Write to <a href={siteConfig.supportEmailHref}>{siteConfig.supportEmail}</a>{siteConfig.supportPhone ? ' or call ' : '.'}</>
          )}
          {siteConfig.supportPhone && (
            <>{!siteConfig.supportEmail && 'Call '}<a href={siteConfig.supportPhoneHref}>{siteConfig.supportPhone}</a>.</>
          )}
        </p>
      )}
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
        <dt>Your child's height and weight (optional)</dt>
        <dd>
          Only if you use the size check before choosing sizes. You can skip it. We use the two numbers to suggest a
          size from the school's size chart. On your phone they are kept until you close the page. When you place an
          order (or straight away, if you are signed in and we know which child it is), we save them on your child's
          record with the date, so you do not have to measure again next time. Each new measurement is added, the
          newest one is used, and none is changed later. We also keep a copy with each shirt or trouser you order,
          next to the size we suggested and the size you chose, so the tailor can check the fit and we can see
          whether an exchange was needed.
        </dd>
        <dt>Your child's shoulder width (optional)</dt>
        <dd>
          Only if you measure with the camera during the size check, or type it in yourself. The camera picture is
          looked at on your phone and never leaves it: it is not uploaded, saved or sent anywhere. Only numbers are
          sent: the shoulder width in cm, how sure the phone was of it, and whether you changed it. We keep them like
          height and weight, below.
        </dd>
        <dt>Your child's photo</dt>
        <dd>
          Only when you order a photo notebook or a student ID card, and only after you tick consent on that
          order. The tick is empty until you choose it. We store the photo, a print file, and a small preview. We
          also store the time you agreed, the policy version, and the IP address and browser of that request.
        </dd>
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
        address only) and the payment partner. Staff of your child's school, and our own staff, can see the
        measurements saved on your child's record, and a teacher who orders for your child can add one. The tailor
        who sews the uniform gets a sheet with your child's name, GR number, class, the sizes ordered and the
        measurements, and nothing else. School staff do not get this sheet. School
        staff who can open the order see a short-lived link to a
        photo notebook or ID card photo. The print file is what the printer uses. There is no separate printer
        login on this site. We do not sell personal data or use it for advertising.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Order records are kept for 8 years because tax law requires it. The original photo and the print file are
        deleted 30 days after the order is marked delivered. The small preview is deleted then too, unless you
        ticked "Keep a small copy for next year's ID card". You can delete every photo we hold for your child,
        and withdraw consent, from My children on your account. Student records are kept while the school is a
        partner and removed within 90 days of the school asking us to, or of the student leaving the school.
      </p>
      <p>
        Measurements saved on your child's record are deleted one year after they were taken, because by then your
        child has grown. Your child's height, weight and shoulder width are removed from the order 90 days after it is delivered, cancelled or
        returned (or 180 days after you ordered, if it never gets there). At that point we keep only the numbers
        with the class, the item, the month and the sizes suggested, chosen and exchanged, without your child's
        name, the order or your account, to make our size suggestions better. Because the item belongs to one
        school, this is not fully anonymous, so we treat it as personal data and never try to work out whose it
        was.
      </p>
      <p>
        Every night we copy the store's records to a private backup with our hosting partner, Cloudflare, so nothing
        is lost if our server fails. Each copy is deleted after 30 days, and only the 14 newest are kept on our own
        server. Backups are only used to restore the store.
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
