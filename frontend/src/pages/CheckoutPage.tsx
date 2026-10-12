import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft } from '../components/ui/icons';
import { formatINR } from '../utils/formatINR';
import { useStoreState } from '../store/storeState';
import { siteConfig } from '../siteConfig';
import { buildOrderMessage, whatsappOrderUrl } from '../services/whatsappOrder';
import { useAuth } from '../auth';
import type { ParentChild } from '../api';
import { ParentSignInSheet } from '../components/parent/ParentSignInSheet';
import '../components/cart/bagCheckout.css';

export function CheckoutPage() {
  const navigate = useNavigate();
  const { cart, subtotalPaise, clearCart, selection } = useStoreState();

  // Current active accordion step: 1, 2, or 3
  const [activeStep, setActiveStep] = useState<number>(1);
  // Orders are not saved on the server yet: the parent sends them to our WhatsApp.
  const [reference] = useState(() => `SS-${Date.now().toString(36).toUpperCase()}`);
  const [sent, setSent] = useState(false);

  // Form Fields State
  const [parentName, setParentName] = useState('');
  const [parentMobile, setParentMobile] = useState('');
  const [studentName, setStudentName] = useState('');
  const [studentClass, setStudentClass] = useState(selection?.gradeName || '');

  // Delivery State
  const [deliveryType, setDeliveryType] = useState<'HOME' | 'SCHOOL'>('HOME');
  const [pinCode, setPinCode] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState(selection?.cityName || '');
  const [state, setState] = useState('Gujarat');

  // Validation Errors
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Sign-in happens here, at order time, never earlier.
  // Mobile + OTP fills the parent; picking a child fills the student.
  const { user } = useAuth();
  const [signInOpen, setSignInOpen] = useState(false);
  const [child, setChild] = useState<ParentChild | null>(null);
  const isParent = user?.role === 'PARENT';

  useEffect(() => {
    if (!isParent || !user) return;
    const digits = (user.phone || '').replace(/\D/g, '').slice(-10);
    if (digits && !parentMobile) setParentMobile(digits);
    const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ');
    if (fullName && !parentName) setParentName(fullName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isParent, user]);

  const handleChildChosen = (picked: ParentChild | null) => {
    setSignInOpen(false);
    if (!picked) return;
    setChild(picked);
    setStudentName(picked.name);
    setStudentClass(picked.grade_name || picked.class_name);
  };

  // Pricing math in integer paise
  const gstPaise = Math.round(subtotalPaise * 0.05); // 5% GST
  const deliveryPaise = deliveryType === 'HOME' && subtotalPaise < 150000 ? 10000 : 0; // ₹100 or free above ₹1500
  const grandTotalPaise = subtotalPaise + gstPaise + deliveryPaise;

  const validateStep1 = () => {
    const errs: Record<string, string> = {};
    if (!parentName.trim()) errs.parentName = 'Parent name is required';
    if (!/^\d{10}$/.test(parentMobile.trim())) errs.parentMobile = 'Enter a valid 10-digit mobile number';
    if (!studentName.trim()) errs.studentName = 'Student name is required';
    if (!studentClass.trim()) errs.studentClass = 'Class is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const validateStep2 = () => {
    const errs: Record<string, string> = {};
    if (deliveryType === 'HOME') {
      if (!/^\d{6}$/.test(pinCode.trim())) errs.pinCode = 'Enter a 6-digit PIN code';
      if (!addressLine1.trim()) errs.addressLine1 = 'Street address is required';
      if (!city.trim()) errs.city = 'City is required';
      if (!state.trim()) errs.state = 'State is required';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const orderMessage = buildOrderMessage({
    reference,
    schoolName: selection?.schoolName,
    studentName,
    studentClass,
    parentName,
    parentMobile,
    deliveryType,
    address: [addressLine1, addressLine2, city, state, pinCode].map((part) => part.trim()).filter(Boolean).join(', '),
    items: cart,
    subtotalPaise,
    gstPaise,
    deliveryPaise,
    totalPaise: grandTotalPaise,
  });
  const whatsappUrl = siteConfig.whatsappNumber ? whatsappOrderUrl(siteConfig.whatsappNumber, orderMessage) : '';

  // Honest hand-off: the order counts only once the parent presses Send in WhatsApp.
  if (sent) {
    return (
      <div className="order-confirmed-wrap container">
        <div className="order-confirmed-card">
          <h1 className="confirmed-heading">Now press Send in WhatsApp</h1>
          <div className="order-num-label">Reference {reference}</div>

          <div className="confirmed-steps">
            <div className="confirmed-step-row">
              <span className="step-circle">1</span>
              <span>Your order is written out in WhatsApp. Tap the green Send button there. The order is booked only after you send it.</span>
            </div>
            <div className="confirmed-step-row">
              <span className="step-circle">2</span>
              <span>
                We will call you on {parentMobile} to confirm the order
                {deliveryType === 'HOME' ? ' and your address.' : ' and when to collect it at school.'}
              </span>
            </div>
            <div className="confirmed-step-row">
              <span className="step-circle">3</span>
              <span>Pay {formatINR(grandTotalPaise)} in cash when you get it. Wrong size? Exchange it within 7 days.</span>
            </div>
          </div>

          <div className="confirmed-actions">
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
              Open WhatsApp again
            </a>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                clearCart();
                navigate('/');
              }}
            >
              I have sent it
            </button>
            <button type="button" className="btn btn-text" onClick={() => setSent(false)}>
              Change my order
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (cart.length === 0) {
    return (
      <div className="checkout-empty container">
        <h2>Your bag is empty</h2>
        <p>Please select items from your school's catalog before checking out.</p>
        <Link to="/" className="btn btn-primary">
          Return to home
        </Link>
      </div>
    );
  }

  return (
    <div className="checkout-page container">
      <div className="checkout-header">
        <button
          type="button"
          className="checkout-back-link"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft width={16} height={16} /> Back to shopping
        </button>
        <h1 className="checkout-title">Express Checkout</h1>
      </div>

      <ParentSignInSheet
        open={signInOpen}
        onClose={() => setSignInOpen(false)}
        onDone={handleChildChosen}
        schoolName={selection?.schoolName}
      />

      <div className="checkout-layout">
        {/* Left Column: 3 Stepped Sections */}
        <div className="checkout-steps-col">
          {/* Section 1: Contact */}
          <section className={`checkout-section ${activeStep === 1 ? 'is-active' : 'is-collapsed'}`}>
            <div
              className="section-step-header"
              onClick={() => activeStep > 1 && setActiveStep(1)}
            >
              <div className="step-badge">1</div>
              <h2 className="step-header-title">Parent & Student Details</h2>
              {activeStep > 1 && <span className="step-edit-btn">Edit</span>}
            </div>

            {activeStep === 1 ? (
              <div className="step-body">
                {!isParent ? (
                  <div className="checkout-signin">
                    <div>
                      <strong>Sign in with your mobile number</strong>
                      <span>We'll fill in your child's details from the school's records.</span>
                    </div>
                    <button type="button" className="btn btn-primary" onClick={() => setSignInOpen(true)}>
                      Continue with OTP
                    </button>
                  </div>
                ) : child ? (
                  <div className="checkout-child">
                    <span>Ordering for</span>
                    <strong>{child.name}</strong>
                    <span>
                      {[child.grade_name || child.class_name, child.section && `Section ${child.section}`]
                        .filter(Boolean)
                        .join(' · ')}{' '}
                      · {child.school_name}
                    </span>
                    {parentMobile && <span>Mobile {parentMobile.slice(0, 5)} {parentMobile.slice(5)} · verified</span>}
                    <button type="button" className="psi-link" onClick={() => setSignInOpen(true)}>
                      Change
                    </button>
                  </div>
                ) : (
                  <button type="button" className="psi-link" onClick={() => setSignInOpen(true)}>
                    Choose your child from the school's records
                  </button>
                )}
                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="input-label" htmlFor="parent-name">Parent Name</label>
                    <input
                      id="parent-name"
                      type="text"
                      autoComplete="name"
                      className={`input-control ${errors.parentName ? 'input-has-err' : ''}`}
                      placeholder="e.g. Ramesh Sharma"
                      value={parentName}
                      onChange={(e) => setParentName(e.target.value)}
                    />
                    {errors.parentName && <span className="field-err">{errors.parentName}</span>}
                  </div>

                  {/* Signed in: the number is already verified by OTP, so no field */}
                  {!isParent && (
                  <div className="form-group">
                    <label className="input-label" htmlFor="parent-mobile">Mobile Number</label>
                    <input
                      id="parent-mobile"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel"
                      maxLength={10}
                      className={`input-control ${errors.parentMobile ? 'input-has-err' : ''}`}
                      placeholder="10-digit mobile number"
                      value={parentMobile}
                      onChange={(e) => setParentMobile(e.target.value.replace(/\D/g, ''))}
                    />
                    {errors.parentMobile && <span className="field-err">{errors.parentMobile}</span>}
                  </div>
                  )}
                </div>

                {/* A child from the school's records needs no student fields */}
                {!child && (
                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="input-label" htmlFor="student-name">Student Name</label>
                    <input
                      id="student-name"
                      type="text"
                      className={`input-control ${errors.studentName ? 'input-has-err' : ''}`}
                      placeholder="Full name for tags & records"
                      value={studentName}
                      onChange={(e) => setStudentName(e.target.value)}
                    />
                    {errors.studentName && <span className="field-err">{errors.studentName}</span>}
                  </div>

                  <div className="form-group">
                    <label className="input-label" htmlFor="student-class">Class / Section</label>
                    <input
                      id="student-class"
                      type="text"
                      className={`input-control ${errors.studentClass ? 'input-has-err' : ''}`}
                      placeholder="e.g. Class 4 B"
                      value={studentClass}
                      onChange={(e) => setStudentClass(e.target.value)}
                    />
                    {errors.studentClass && <span className="field-err">{errors.studentClass}</span>}
                  </div>
                </div>
                )}

                <button
                  type="button"
                  className="btn btn-primary step-next-btn"
                  onClick={() => {
                    if (validateStep1()) setActiveStep(2);
                  }}
                >
                  Continue to Delivery
                </button>
              </div>
            ) : (
              <div className="step-summary-view">
                <span>{parentName} · {parentMobile}</span>
                <span>Student: {studentName} ({studentClass})</span>
              </div>
            )}
          </section>

          {/* Section 2: Delivery */}
          <section className={`checkout-section ${activeStep === 2 ? 'is-active' : 'is-collapsed'}`}>
            <div
              className="section-step-header"
              onClick={() => activeStep > 2 && setActiveStep(2)}
            >
              <div className="step-badge">2</div>
              <h2 className="step-header-title">Delivery Method</h2>
              {activeStep > 2 && <span className="step-edit-btn">Edit</span>}
            </div>

            {activeStep === 2 ? (
              <div className="step-body">
                <div className="delivery-radio-group">
                  <label className={`delivery-radio-card ${deliveryType === 'HOME' ? 'is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="deliveryType"
                      checked={deliveryType === 'HOME'}
                      onChange={() => setDeliveryType('HOME')}
                    />
                    <div>
                      <strong>Home Delivery</strong>
                      <p>Dispatched to your doorstep within 3-4 working days.</p>
                    </div>
                  </label>

                  <label className={`delivery-radio-card ${deliveryType === 'SCHOOL' ? 'is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="deliveryType"
                      checked={deliveryType === 'SCHOOL'}
                      onChange={() => setDeliveryType('SCHOOL')}
                    />
                    <div>
                      <strong>Collect at School Campus</strong>
                      <p>Ready for pickup at the official distribution desk (Free).</p>
                    </div>
                  </label>
                </div>

                {deliveryType === 'HOME' && (
                  <div className="address-form-fields">
                    <div className="form-grid-2">
                      <div className="form-group">
                        <label className="input-label" htmlFor="pincode">PIN Code</label>
                        <input
                          id="pincode"
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          autoComplete="postal-code"
                          className={`input-control ${errors.pinCode ? 'input-has-err' : ''}`}
                          placeholder="6 digits"
                          value={pinCode}
                          onChange={(e) => setPinCode(e.target.value.replace(/\D/g, ''))}
                        />
                        {errors.pinCode && <span className="field-err">{errors.pinCode}</span>}
                      </div>

                      <div className="form-group">
                        <label className="input-label" htmlFor="city">City</label>
                        <input
                          id="city"
                          type="text"
                          autoComplete="address-level2"
                          className={`input-control ${errors.city ? 'input-has-err' : ''}`}
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="form-group">
                      <label className="input-label" htmlFor="addr-1">Address Line 1</label>
                      <input
                        id="addr-1"
                        type="text"
                        autoComplete="street-address"
                        className={`input-control ${errors.addressLine1 ? 'input-has-err' : ''}`}
                        placeholder="House / Flat No., Society / Building"
                        value={addressLine1}
                        onChange={(e) => setAddressLine1(e.target.value)}
                      />
                      {errors.addressLine1 && <span className="field-err">{errors.addressLine1}</span>}
                    </div>

                    <div className="form-group">
                      <label className="input-label" htmlFor="addr-2">Address Line 2 (Optional)</label>
                      <input
                        id="addr-2"
                        type="text"
                        className="input-control"
                        placeholder="Landmark, Area / Sector"
                        value={addressLine2}
                        onChange={(e) => setAddressLine2(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  className="btn btn-primary step-next-btn"
                  onClick={() => {
                    if (validateStep2()) setActiveStep(3);
                  }}
                >
                  Continue to Payment
                </button>
              </div>
            ) : activeStep > 2 ? (
              <div className="step-summary-view">
                <span>
                  {deliveryType === 'HOME'
                    ? `Home Delivery: ${addressLine1}, ${city} (${pinCode})`
                    : 'Collection at School Campus'}
                </span>
              </div>
            ) : null}
          </section>

          {/* Section 3: Payment */}
          <section className={`checkout-section ${activeStep === 3 ? 'is-active' : 'is-collapsed'}`}>
            <div className="section-step-header">
              <div className="step-badge">3</div>
              <h2 className="step-header-title">Payment</h2>
            </div>

            {activeStep === 3 && (
              <div className="step-body">
                <div className="payment-options-grid">
                  <div className="payment-option is-selected">
                    <div>
                      <strong>Pay cash when it arrives</strong>
                      <p>Cash on delivery. Paying online by UPI is coming soon.</p>
                    </div>
                  </div>
                </div>

                {whatsappUrl ? (
                  <>
                    <a
                      href={whatsappUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-primary pay-now-btn"
                      onClick={() => {
                        setSent(true);
                        window.scrollTo(0, 0);
                      }}
                    >
                      Send order on WhatsApp · {formatINR(grandTotalPaise)}
                    </a>
                    <p className="checkout-legal-note">
                      WhatsApp opens with your order written out; press Send there to book it. By ordering you agree to
                      our <Link to="/terms">Terms</Link>, <Link to="/refunds">Refund Policy</Link> and{' '}
                      <Link to="/privacy">Privacy Policy</Link>.
                    </p>
                  </>
                ) : (
                  <p className="checkout-closed-note" role="status">
                    Online ordering opens soon. Your items stay saved in your bag.
                  </p>
                )}
              </div>
            )}
          </section>
        </div>

        {/* Right Column: Sticky Order Summary */}
        <aside className="checkout-summary-col">
          <div className="order-summary-box">
            <h3 className="summary-title">Order Summary</h3>

            <div className="summary-items-list">
              {cart.map((item) => (
                <div key={item.id} className="summary-item-row">
                  <div className="summary-item-main">
                    <span className="summary-item-qty">{item.quantity}×</span>
                    <span className="summary-item-name">{item.name} ({item.size})</span>
                  </div>
                  <span className="summary-item-price">
                    {formatINR(item.pricePaise * item.quantity)}
                  </span>
                </div>
              ))}
            </div>

            <div className="summary-math-table">
              <div className="math-row">
                <span>Subtotal</span>
                <span>{formatINR(subtotalPaise)}</span>
              </div>
              <div className="math-row">
                <span>GST (5%)</span>
                <span>{formatINR(gstPaise)}</span>
              </div>
              <div className="math-row">
                <span>Delivery</span>
                <span>{deliveryPaise === 0 ? 'Free' : formatINR(deliveryPaise)}</span>
              </div>

              <div className="math-total-row">
                <span>Total Due</span>
                <span className="total-amount">{formatINR(grandTotalPaise)}</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
