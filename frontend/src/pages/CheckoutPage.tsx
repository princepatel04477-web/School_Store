import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft } from '../components/ui/icons';
import { formatINR } from '../utils/formatINR';
import { useStoreState } from '../store/storeState';
import { siteConfig } from '../siteConfig';
import { useStoreSchools } from '../data/catalog';
import { buildOrderMessage, whatsappOrderUrl } from '../services/whatsappOrder';
import { orderErrorMessage, prepareOrder, submitOrder, type PlacedOrder } from '../services/placeOrder';
import { useAuth } from '../auth';
import type { ParentChild } from '../api';
import { ParentSignInSheet } from '../components/parent/ParentSignInSheet';
import '../components/cart/bagCheckout.css';

/**
 * Two ways to order:
 * - account: the parent signs in with mobile + OTP and picks their child from the
 *   school's records; the order is saved on the server (cash on delivery).
 * - whatsapp: when sign-in isn't possible, the written-out order goes to the store's
 *   WhatsApp and the store calls back. Only offered when a WhatsApp number is set.
 */
export function CheckoutPage() {
  const navigate = useNavigate();
  const { cart, subtotalPaise, clearCart, selection } = useStoreState();

  const [activeStep, setActiveStep] = useState<number>(1);
  const [mode, setMode] = useState<'account' | 'whatsapp'>('account');

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

  // Placing the order
  const [placing, setPlacing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [orderError, setOrderError] = useState('');
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);

  // WhatsApp hand-off
  const [reference] = useState(() => `SS-${Date.now().toString(36).toUpperCase()}`);
  const [sentOnWhatsApp, setSentOnWhatsApp] = useState(false);

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
    setMode('account');
    setChild(picked);
    setStudentName(picked.name);
    setStudentClass(picked.grade_name || picked.class_name);
  };

  // Only offer the delivery choices the child's school accepts.
  const { data: schools = [] } = useStoreSchools();
  const school = schools.find((s) => s.id === (child?.school || selection?.schoolId));
  const canDeliverHome = school?.homeDelivery ?? true;
  const canCollect = school?.schoolPickup ?? true;
  useEffect(() => {
    if (deliveryType === 'HOME' && !canDeliverHome && canCollect) setDeliveryType('SCHOOL');
    if (deliveryType === 'SCHOOL' && !canCollect && canDeliverHome) setDeliveryType('HOME');
  }, [deliveryType, canDeliverHome, canCollect]);

  // Items were picked for one school; the child must be at that school.
  const wrongSchool = Boolean(child && selection?.schoolId && child.school !== selection.schoolId);

  // The server charges exactly the items' prices: no extra tax or delivery lines.
  const totalPaise = subtotalPaise;
  const whatsappAvailable = Boolean(siteConfig.whatsappNumber);

  const validateStep1 = () => {
    const errs: Record<string, string> = {};
    if (!parentName.trim()) errs.parentName = 'Please write your name';
    if (mode === 'account') {
      if (!child) errs.child = 'Please choose your child';
      else if (wrongSchool) errs.child = 'Your bag has items for another school';
    } else {
      if (!/^\d{10}$/.test(parentMobile.trim())) errs.parentMobile = 'Enter a valid 10-digit mobile number';
      if (!studentName.trim()) errs.studentName = 'Student name is required';
      if (!studentClass.trim()) errs.studentClass = 'Class is required';
    }
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

  const homeAddress = [addressLine1, addressLine2, city, state, pinCode].map((part) => part.trim()).filter(Boolean).join(', ');

  const handlePlaceOrder = async () => {
    if (!child || placing) return;
    setOrderError('');
    setPlacing(true);
    setRetrying(false);
    const contact = { recipient_name: parentName.trim(), phone: parentMobile };
    const payload = prepareOrder({
      student: child.id,
      fulfillment_type: deliveryType === 'HOME' ? 'HOME_DELIVERY' : 'SCHOOL_PICKUP',
      payment_method: 'COD',
      delivery_details:
        deliveryType === 'HOME'
          ? {
              ...contact,
              address: [addressLine1, addressLine2].map((part) => part.trim()).filter(Boolean).join(', '),
              city: city.trim(),
              state: state.trim(),
              pincode: pinCode.trim(),
            }
          : contact,
      items: cart.map((item) => ({ variant: item.variantId, quantity: item.quantity })),
    });
    try {
      const order = await submitOrder(payload, () => setRetrying(true));
      setPlaced(order);
      clearCart();
      window.scrollTo(0, 0);
    } catch (error) {
      setOrderError(orderErrorMessage(error));
    } finally {
      setPlacing(false);
      setRetrying(false);
    }
  };

  const orderMessage = buildOrderMessage({
    reference,
    schoolName: selection?.schoolName,
    studentName,
    studentClass,
    parentName,
    parentMobile,
    deliveryType,
    address: homeAddress,
    items: cart,
    totalPaise,
  });
  const whatsappUrl = whatsappAvailable ? whatsappOrderUrl(siteConfig.whatsappNumber, orderMessage) : '';

  // The server saved the order.
  if (placed) {
    const placedTotal = formatINR(Math.round(parseFloat(placed.total) * 100));
    const collect = placed.fulfillment_type === 'SCHOOL_PICKUP';
    return (
      <div className="order-confirmed-wrap container">
        <div className="order-confirmed-card">
          <h1 className="confirmed-heading">Order placed</h1>
          <div className="order-num-label">Order number {placed.order_number}</div>

          <div className="confirmed-steps">
            <div className="confirmed-step-row">
              <span className="step-circle">1</span>
              <span>Your order for {placed.student_name || studentName} is saved. Your school can see it.</span>
            </div>
            <div className="confirmed-step-row">
              <span className="step-circle">2</span>
              <span>
                {collect
                  ? `Collect it at ${school?.name || 'your school'}. Pay ${placedTotal} in cash when you collect it.`
                  : `We will bring it to your home. Pay ${placedTotal} in cash when it arrives.`}
              </span>
            </div>
            <div className="confirmed-step-row">
              <span className="step-circle">3</span>
              <span>Wrong size? Exchange it within 7 days.</span>
            </div>
          </div>

          <div className="confirmed-actions">
            <Link to="/parent/orders" className="btn btn-primary">
              See my orders
            </Link>
            <Link to="/" className="btn btn-text">
              Back to home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Honest hand-off: the order counts only once the parent presses Send in WhatsApp.
  if (sentOnWhatsApp) {
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
              <span>Pay {formatINR(totalPaise)} in cash when you get it. Wrong size? Exchange it within 7 days.</span>
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
            <button type="button" className="btn btn-text" onClick={() => setSentOnWhatsApp(false)}>
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
                {mode === 'account' ? (
                  <>
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
                      <button type="button" className="btn btn-primary" onClick={() => setSignInOpen(true)}>
                        Choose your child
                      </button>
                    )}

                    {wrongSchool && (
                      <p className="field-err" role="alert">
                        Your bag has items for {selection?.schoolName}, but {child?.name} is at {child?.school_name}.
                        Choose another child, or empty your bag and shop for {child?.school_name}.
                      </p>
                    )}
                    {errors.child && !wrongSchool && <span className="field-err">{errors.child}</span>}

                    {isParent && (
                      <div className="form-group">
                        <label className="input-label" htmlFor="parent-name">Your Name</label>
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
                    )}

                    {whatsappAvailable && !child && (
                      <button type="button" className="psi-link" onClick={() => setMode('whatsapp')}>
                        Can't sign in? Send your order on WhatsApp instead
                      </button>
                    )}
                  </>
                ) : (
                  <>
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
                    </div>

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

                    <button type="button" className="psi-link" onClick={() => setMode('account')}>
                      Sign in with your mobile number instead
                    </button>
                  </>
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
                  {canDeliverHome && (
                    <label className={`delivery-radio-card ${deliveryType === 'HOME' ? 'is-selected' : ''}`}>
                      <input
                        type="radio"
                        name="deliveryType"
                        checked={deliveryType === 'HOME'}
                        onChange={() => setDeliveryType('HOME')}
                      />
                      <div>
                        <strong>Home Delivery</strong>
                        <p>Brought to your door.</p>
                      </div>
                    </label>
                  )}

                  {canCollect && (
                    <label className={`delivery-radio-card ${deliveryType === 'SCHOOL' ? 'is-selected' : ''}`}>
                      <input
                        type="radio"
                        name="deliveryType"
                        checked={deliveryType === 'SCHOOL'}
                        onChange={() => setDeliveryType('SCHOOL')}
                      />
                      <div>
                        <strong>Collect at School</strong>
                        <p>Pick it up at {school?.name || 'your school'}.</p>
                      </div>
                    </label>
                  )}
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
                        {errors.city && <span className="field-err">{errors.city}</span>}
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
                    : `Collect at ${school?.name || 'school'}`}
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

                {mode === 'account' ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-primary pay-now-btn"
                      onClick={handlePlaceOrder}
                      disabled={placing}
                      aria-busy={placing}
                    >
                      {placing
                        ? retrying
                          ? 'Weak signal, still trying…'
                          : 'Placing your order…'
                        : `Place order · ${formatINR(totalPaise)}`}
                    </button>
                    {orderError && (
                      <p className="field-err checkout-order-error" role="alert">
                        {orderError}
                      </p>
                    )}
                    <p className="checkout-legal-note">
                      By ordering you agree to our <Link to="/terms">Terms</Link>, <Link to="/refunds">Refund Policy</Link>{' '}
                      and <Link to="/privacy">Privacy Policy</Link>.
                    </p>
                  </>
                ) : whatsappUrl ? (
                  <>
                    <a
                      href={whatsappUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-primary pay-now-btn"
                      onClick={() => {
                        setSentOnWhatsApp(true);
                        window.scrollTo(0, 0);
                      }}
                    >
                      Send order on WhatsApp · {formatINR(totalPaise)}
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
                <span>Delivery</span>
                <span>Free</span>
              </div>

              <div className="math-total-row">
                <span>Total</span>
                <span className="total-amount">{formatINR(totalPaise)}</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
