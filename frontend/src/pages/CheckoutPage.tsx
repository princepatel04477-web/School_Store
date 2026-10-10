import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ShieldCheck } from '../components/ui/icons';
import { formatINR } from '../utils/formatINR';
import { useStoreState } from '../store/storeState';
import { paymentAdapter } from '../services/paymentAdapter';
import { motion, AnimatePresence } from 'motion/react';
import { Thread } from '../motion/Thread';
import { EASING, DURATION_FAST, DURATION_BASE } from '../motion/motionConfig';
import { useAuth } from '../auth';
import type { ParentChild } from '../api';
import { ParentSignInSheet } from '../components/parent/ParentSignInSheet';
import '../components/cart/bagCheckout.css';

export function CheckoutPage() {
  const navigate = useNavigate();
  const { cart, subtotalPaise, clearCart, selection } = useStoreState();

  // Current active accordion step: 1, 2, or 3
  const [activeStep, setActiveStep] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderComplete, setOrderComplete] = useState<any | null>(null);

  // Form Fields State
  const [parentName, setParentName] = useState('');
  const [parentMobile, setParentMobile] = useState('');
  const [parentEmail, setParentEmail] = useState('');
  const [studentName, setStudentName] = useState('');
  const [studentClass, setStudentClass] = useState(selection?.gradeName || 'Class 5');

  // Delivery State
  const [deliveryType, setDeliveryType] = useState<'HOME' | 'SCHOOL'>('HOME');
  const [pinCode, setPinCode] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState(selection?.cityName || 'Gurugram');
  const [state, setState] = useState('Haryana');

  // Payment Method
  const [paymentMethod, setPaymentMethod] = useState<'UPI' | 'CARD' | 'NETBANKING' | 'COD'>('UPI');

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
    // Optional: order updates go to WhatsApp; email is only for a copy of the receipt
    if (parentEmail.trim() && !parentEmail.includes('@')) errs.parentEmail = 'Enter a valid email address';
    if (!studentName.trim()) errs.studentName = 'Student name is required';
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

  const handlePay = async () => {
    if (isSubmitting) return; // Prevent double submit
    setIsSubmitting(true);

    try {
      const orderId = `ORD-${Date.now().toString().slice(-6)}`;
      const res = await paymentAdapter.initiatePayment({
        orderId,
        amountPaise: grandTotalPaise,
        currency: 'INR',
        method: paymentMethod,
        customer: {
          name: parentName,
          phone: parentMobile,
          email: parentEmail,
        },
      });

      if (res.success) {
        setOrderComplete({
          orderNumber: orderId,
          totalPaise: grandTotalPaise,
          studentName,
          itemsCount: cart.length,
          deliveryType,
        });
        clearCart();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (orderComplete) {
    return (
      <div className="order-confirmed-wrap container">
        <div className="order-confirmed-card">
          <motion.div
            className="confirmed-badge"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: DURATION_BASE, ease: EASING }}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <motion.path
                d="M5 12.5l4.5 4.5L19 7.5"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: DURATION_BASE, delay: 0.2, ease: EASING }}
              />
            </svg>
          </motion.div>
          <h1 className="confirmed-heading">Order placed</h1>
          <Thread className="confirmed-thread" />
          <div className="order-num-label">Order Reference #{orderComplete.orderNumber}</div>

          <div className="confirmed-steps">
            <div className="confirmed-step-row">
              <span className="step-circle">1</span>
              <span>We’ve sent the invoice and tracking details to {parentEmail}.</span>
            </div>
            <div className="confirmed-step-row">
              <span className="step-circle">2</span>
              <span>
                {orderComplete.deliveryType === 'HOME'
                  ? 'Your items will be inspected and dispatched via express courier.'
                  : 'Your package will be ready for pickup at your school distribution counter.'}
              </span>
            </div>
            <div className="confirmed-step-row">
              <span className="step-circle">3</span>
              <span>Easy size exchange available within 7 days of package delivery.</span>
            </div>
          </div>

          <div className="confirmed-actions">
            <Link to="/parent/orders" className="btn btn-outline">
              Track order
            </Link>
            <Link to="/" className="btn btn-text">
              Back to home
            </Link>
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

                <div className="form-group">
                  <label className="input-label" htmlFor="parent-email">Email (optional, for the receipt)</label>
                  <input
                    id="parent-email"
                    type="email"
                    autoComplete="email"
                    className={`input-control ${errors.parentEmail ? 'input-has-err' : ''}`}
                    placeholder="name@domain.com"
                    value={parentEmail}
                    onChange={(e) => setParentEmail(e.target.value)}
                  />
                  {errors.parentEmail && <span className="field-err">{errors.parentEmail}</span>}
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
                      className="input-control"
                      value={studentClass}
                      onChange={(e) => setStudentClass(e.target.value)}
                    />
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
              <h2 className="step-header-title">Payment Method</h2>
            </div>

            {activeStep === 3 && (
              <div className="step-body">
                <div className="payment-options-grid">
                  <label className={`payment-option ${paymentMethod === 'UPI' ? 'is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="paymentMethod"
                      checked={paymentMethod === 'UPI'}
                      onChange={() => setPaymentMethod('UPI')}
                    />
                    <div>
                      <strong>UPI (GPay / PhonePe / Paytm / QR)</strong>
                      <p>Instant contactless authorization</p>
                    </div>
                  </label>

                  <label className={`payment-option ${paymentMethod === 'CARD' ? 'is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="paymentMethod"
                      checked={paymentMethod === 'CARD'}
                      onChange={() => setPaymentMethod('CARD')}
                    />
                    <div>
                      <strong>Credit / Debit Card</strong>
                      <p>Visa, MasterCard, RuPay (Hosted security)</p>
                    </div>
                  </label>

                  <label className={`payment-option ${paymentMethod === 'NETBANKING' ? 'is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="paymentMethod"
                      checked={paymentMethod === 'NETBANKING'}
                      onChange={() => setPaymentMethod('NETBANKING')}
                    />
                    <div>
                      <strong>Net Banking</strong>
                      <p>All major Indian banks</p>
                    </div>
                  </label>

                  <label className={`payment-option ${paymentMethod === 'COD' ? 'is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="paymentMethod"
                      checked={paymentMethod === 'COD'}
                      onChange={() => setPaymentMethod('COD')}
                    />
                    <div>
                      <strong>Cash on Delivery (COD)</strong>
                      <p>Pay upon physical receipt</p>
                    </div>
                  </label>
                </div>

                <div className="payment-security-note">
                  <ShieldCheck width={18} height={18} />
                  <span>256-bit encrypted checkout. Card details never stored on servers.</span>
                </div>

                <button
                  type="button"
                  className={`btn btn-primary pay-now-btn ${isSubmitting ? 'is-paying' : ''}`}
                  onClick={handlePay}
                  disabled={isSubmitting}
                  aria-busy={isSubmitting}
                >
                  <span className="pay-btn-labels">
                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.span
                        key={isSubmitting ? 'paying' : 'pay'}
                        className="pay-btn-label"
                        initial={{ y: '110%', opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: '-110%', opacity: 0 }}
                        transition={{ duration: DURATION_FAST, ease: EASING }}
                      >
                        {isSubmitting ? (
                          <>
                            <span className="pay-btn-spinner" aria-hidden="true" />
                            Authorizing payment…
                          </>
                        ) : (
                          `Pay ${formatINR(grandTotalPaise)}`
                        )}
                      </motion.span>
                    </AnimatePresence>
                  </span>
                </button>
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
