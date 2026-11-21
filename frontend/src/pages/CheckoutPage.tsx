import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft } from '../components/ui/icons';
import { formatINR } from '../utils/formatINR';
import { useStoreState } from '../store/storeState';
import { siteConfig } from '../siteConfig';
import { useStoreSchools } from '../data/catalog';
import { fitPayload } from '../data/fit';
import { buildOrderMessage, whatsappOrderUrl } from '../services/whatsappOrder';
import { orderErrorMessage, prepareOrder, submitOrder, clearPendingOrder, type PlacedOrder } from '../services/placeOrder';
import { loadRazorpay, openRazorpayCheckout } from '../services/paymentAdapter';
import { useAuth } from '../auth';
import { useLang } from '../i18n';
import { classLabel } from '../i18n/labels';
import { api, ApiError, orderApi, type ParentChild, type Order, type OrderQuote } from '../api';
import { ParentSignInSheet } from '../components/parent/ParentSignInSheet';
import { scrollPageTo } from '../motion/SmoothScroll';
import '../components/cart/bagCheckout.css';

export const INDIAN_STATES_AND_UTS = [
  'Andaman and Nicobar Islands',
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chandigarh',
  'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jammu and Kashmir',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Ladakh',
  'Lakshadweep',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Puducherry',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
] as const;

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
  const { t } = useLang();

  const [activeStep, setActiveStep] = useState<number>(1);
  const [mode, setMode] = useState<'account' | 'whatsapp'>('account');

  // Form Fields State
  const [parentName, setParentName] = useState('');
  const [parentMobile, setParentMobile] = useState('');
  const [studentName, setStudentName] = useState('');
  const [studentClass, setStudentClass] = useState(selection?.gradeName ? classLabel(selection.gradeName, t) : '');

  // Delivery State
  const [deliveryType, setDeliveryType] = useState<'HOME' | 'SCHOOL'>('HOME');
  const [pinCode, setPinCode] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState(selection?.cityName || '');
  const [state, setState] = useState(selection?.stateName || '');
  const [cityTouched, setCityTouched] = useState(false);
  const [stateTouched, setStateTouched] = useState(false);
  const [pinLookupLoading, setPinLookupLoading] = useState(false);
  const [serviceability, setServiceability] = useState<{
    status: 'SERVICEABLE' | 'UNSERVICEABLE' | 'UNKNOWN';
    message: string;
    provider: string | null;
  } | null>(null);

  // Validation Errors
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Placing the order
  const [placing, setPlacing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [orderError, setOrderError] = useState('');
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);

  // Online Payment & Quote State
  const [quote, setQuote] = useState<OrderQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<'ONLINE' | 'COD'>('ONLINE');
  const [priceNotice, setPriceNotice] = useState('');
  const [paymentStep, setPaymentStep] = useState<'idle' | 'checking' | 'confirming' | 'failed' | 'done'>('idle');
  const [inProgressWarning, setInProgressWarning] = useState(false);
  const [onlineOrder, setOnlineOrder] = useState<PlacedOrder | null>(null);
  const [lastAttemptReason, setLastAttemptReason] = useState('');
  const [willTextMessage, setWillTextMessage] = useState(false);
  const reconcileLastCallRef = useRef<number>(0);
  const pollingIntervalRef = useRef<any>(null);
  const pollingTimeoutRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
      if (pollingTimeoutRef.current) clearTimeout(pollingTimeoutRef.current);
    };
  }, []);

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
    setStudentClass(classLabel(picked.grade_name || picked.class_name, t));
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

  useEffect(() => {
    if (!stateTouched && !state) {
      if (selection?.stateName) {
        setState(selection.stateName);
      } else if (school?.state) {
        setState(school.state);
      }
    }
  }, [selection?.stateName, school?.state, state, stateTouched]);

  useEffect(() => {
    if (!cityTouched && !city) {
      if (selection?.cityName) {
        setCity(selection.cityName);
      } else if (school?.city) {
        setCity(school.city);
      }
    }
  }, [selection?.cityName, school?.city, city, cityTouched]);

  const handlePinChange = async (value: string) => {
    const clean = value.replace(/\D/g, '').slice(0, 6);
    setPinCode(clean);
    setServiceability(null);

    if (clean.length === 6) {
      if (!/^[1-9]\d{5}$/.test(clean)) {
        setErrors((prev) => ({ ...prev, pinCode: t('co.err.pinInvalid') }));
        return;
      }
      setErrors((prev) => {
        const next = { ...prev };
        delete next.pinCode;
        return next;
      });
      setPinLookupLoading(true);
      try {
        const res = await orderApi.pincodeLookup(clean);
        if (res.format_valid && res.geography?.found) {
          if (!cityTouched && res.geography.city) {
            setCity(res.geography.city);
          }
          if (!stateTouched && res.geography.state) {
            setState(res.geography.state);
          }
        }
        setServiceability(res.serviceability);
      } catch {
        setServiceability({
          status: 'UNKNOWN',
          message: 'Courier serviceability could not be confirmed.',
          provider: null,
        });
      } finally {
        setPinLookupLoading(false);
      }
    }
  };

  // Items were picked for one school; the child must be at that school.
  const wrongSchool = Boolean(child && selection?.schoolId && child.school !== selection.schoolId);

  // The server charges exactly the items' prices: no extra tax or delivery lines.
  const totalPaise = subtotalPaise;
  const whatsappAvailable = Boolean(siteConfig.whatsappNumber);

  const validateStep1 = () => {
    const errs: Record<string, string> = {};
    if (!parentName.trim()) errs.parentName = t('co.err.name');
    if (mode === 'account') {
      // Before sign-in there is no child to choose yet, so ask for the sign-in first.
      if (!isParent) errs.child = t('co.err.signIn');
      else if (!child) errs.child = t('co.err.child');
      else if (wrongSchool) errs.child = t('co.err.otherSchool');
    } else {
      if (!/^\d{10}$/.test(parentMobile.trim())) errs.parentMobile = t('co.err.mobile');
      if (!studentName.trim()) errs.studentName = t('co.err.student');
      if (!studentClass.trim()) errs.studentClass = t('co.err.class');
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const validateStep2 = () => {
    const errs: Record<string, string> = {};
    if (deliveryType === 'HOME') {
      if (!/^[1-9]\d{5}$/.test(pinCode.trim())) {
        errs.pinCode = t('co.err.pin');
      } else if (serviceability?.status === 'UNSERVICEABLE') {
        errs.pinCode = t('co.pinUnserviceable');
      }
      if (!addressLine1.trim()) errs.addressLine1 = t('co.err.address');
      if (!city.trim()) errs.city = t('co.err.city');
      if (!state.trim()) errs.state = t('co.err.state');
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const homeAddress = [addressLine1, addressLine2, city, state, pinCode].map((part) => part.trim()).filter(Boolean).join(', ');

  const fetchQuote = useCallback(async () => {
    if (!child || cart.length === 0) return;
    setQuoteLoading(true);
    try {
      const q = await orderApi.quote({
        student: child.id,
        items: cart.map((item) => ({
          variant: item.variantId,
          quantity: item.quantity,
          ...(item.measurement ? { fit: fitPayload(item.measurement) } : {}),
        })),
      });
      setQuote(q);
      if (q.payment_methods.includes('ONLINE')) {
        setSelectedMethod('ONLINE');
      } else {
        setSelectedMethod('COD');
      }
    } catch {
      // Keep existing total or fallback
    } finally {
      setQuoteLoading(false);
    }
  }, [child, cart]);

  useEffect(() => {
    if (activeStep === 3 && mode === 'account' && child) {
      fetchQuote();
    }
  }, [activeStep, mode, child, fetchQuote]);

  const stopPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    if (pollingTimeoutRef.current) {
      clearTimeout(pollingTimeoutRef.current);
      pollingTimeoutRef.current = null;
    }
  };

  const startPolling = (orderId: string) => {
    setPaymentStep('confirming');
    setWillTextMessage(false);
    stopPolling();

    pollingIntervalRef.current = setInterval(async () => {
      try {
        const order = await api<Order>(`/orders/${orderId}/`);
        if (order.payment_status === 'PAID' || order.status === 'CONFIRMED') {
          stopPolling();
          setPaymentStep('done');
          clearPendingOrder();
          clearCart();
          setPlaced({
            id: order.id,
            order_number: order.order_number,
            total: String(order.total),
            student_name: order.student_name,
            fulfillment_type: order.fulfillment_type || 'HOME_DELIVERY',
            status: order.status,
            payment_status: order.payment_status,
            payment_method: order.payment_method,
          });
          scrollPageTo(0);
        }
      } catch {
        // Keep polling until timeout
      }
    }, 3000);

    pollingTimeoutRef.current = setTimeout(() => {
      stopPolling();
      setWillTextMessage(true);
    }, 120000);
  };

  const handlePaymentSuccess = async (order: PlacedOrder, response: any) => {
    setPaymentStep('confirming');
    setOrderError('');
    try {
      const res = await orderApi.verifyPayment(order.id, {
        razorpay_order_id: response.razorpay_order_id,
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_signature: response.razorpay_signature,
      });
      if (res.status === 'paid') {
        setPaymentStep('done');
        clearPendingOrder();
        clearCart();
        setPlaced({
          ...order,
          status: 'CONFIRMED',
          payment_status: 'PAID',
        });
        scrollPageTo(0);
        return;
      }
    } catch {
      // Verify failed or returned confirming: fall through to poll
    }
    startPolling(order.id);
  };

  const handleReconcile = async (orderId: string) => {
    const now = Date.now();
    if (now - reconcileLastCallRef.current < 5000) {
      return;
    }
    reconcileLastCallRef.current = now;
    setPaymentStep('checking');
    setOrderError('');
    try {
      const res = await orderApi.reconcilePayment(orderId);
      if (res.payment_status === 'PAID' || res.status === 'CONFIRMED') {
        stopPolling();
        setPaymentStep('done');
        clearPendingOrder();
        clearCart();
        if (onlineOrder) {
          setPlaced({
            ...onlineOrder,
            status: 'CONFIRMED',
            payment_status: 'PAID',
          });
        }
        scrollPageTo(0);
        return;
      }
      if (res.has_in_progress_attempt) {
        setPaymentStep('checking');
        setInProgressWarning(true);
        return;
      }
      setInProgressWarning(false);
      setPaymentStep('failed');
      if (res.last_attempt_failed) {
        setLastAttemptReason(t('co.tryAgain'));
      }
    } catch {
      setPaymentStep('failed');
      setInProgressWarning(false);
    }
  };

  const handleCheckoutDismissed = (orderId: string) => {
    setPaymentStep('checking');
    handleReconcile(orderId);
  };

  const handlePaymentFailure = (errorResponse: any) => {
    setPaymentStep('failed');
    setInProgressWarning(false);
    const desc = errorResponse?.error?.description || errorResponse?.description || '';
    setLastAttemptReason(desc);
  };

  const initiateOnlinePayment = async (order: PlacedOrder) => {
    setOrderError('');
    try {
      const paymentInfo = await orderApi.payment(order.id);
      const loaded = await loadRazorpay();
      if (!loaded) {
        setOrderError('Could not load payment gateway. Please check your connection.');
        return;
      }
      openRazorpayCheckout({
        key: paymentInfo.key_id,
        order_id: paymentInfo.razorpay_order_id,
        amount: paymentInfo.amount_paise,
        currency: paymentInfo.currency,
        name: 'School Store',
        description: `Order #${paymentInfo.store_order_number || order.order_number}`,
        prefill: paymentInfo.prefill,
        timeout: 840,
        modal: {
          ondismiss: () => {
            handleCheckoutDismissed(order.id);
          },
        },
        handler: async (response) => {
          await handlePaymentSuccess(order, response);
        },
        onPaymentFailed: (errRes) => {
          handlePaymentFailure(errRes);
        },
      });
    } catch (error) {
      setOrderError(t(orderErrorMessage(error)));
    }
  };

  const handleSwitchToCod = async () => {
    if (!onlineOrder) return;
    setPlacing(true);
    setOrderError('');
    try {
      const res = await orderApi.switchToCod(onlineOrder.id);
      stopPolling();
      clearPendingOrder();
      clearCart();
      setPlaced({
        ...onlineOrder,
        payment_method: 'COD',
        payment_status: 'PENDING',
        status: res.status || 'PLACED',
      });
      scrollPageTo(0);
    } catch (error) {
      setOrderError(t(orderErrorMessage(error)));
    } finally {
      setPlacing(false);
    }
  };

  const effectiveTotalPaise = quote ? quote.total_paise : totalPaise;

  const handlePlaceOrder = async () => {
    if (!child || placing) return;
    setOrderError('');
    setPriceNotice('');
    setPlacing(true);
    setRetrying(false);
    const contact = { recipient_name: parentName.trim(), phone: parentMobile };
    const payload = prepareOrder({
      student: child.id,
      fulfillment_type: deliveryType === 'HOME' ? 'HOME_DELIVERY' : 'SCHOOL_PICKUP',
      payment_method: selectedMethod,
      expected_total_paise: effectiveTotalPaise,
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
      // Each shirt or trouser carries the measurement it was sized from (Prompt 23).
      items: cart.map((item) => ({
        variant: item.variantId,
        quantity: item.quantity,
        ...(item.measurement ? { fit: fitPayload(item.measurement) } : {}),
      })),
    });

    try {
      const order = await submitOrder(payload, () => setRetrying(true));
      if (selectedMethod === 'COD') {
        clearPendingOrder();
        setPlaced(order);
        clearCart();
        scrollPageTo(0);
      } else {
        setOnlineOrder(order);
        await initiateOnlinePayment(order);
      }
    } catch (error: any) {
      if (error instanceof ApiError && error.status === 409 && (error.data?.code === 'price_changed' || String(error.data?.detail || '').includes('Price changed'))) {
        setPriceNotice(t('co.priceChanged'));
        if (error.data?.quote) {
          setQuote(error.data.quote as OrderQuote);
        } else {
          await fetchQuote();
        }
      } else {
        setOrderError(t(orderErrorMessage(error)));
      }
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
    totalPaise: effectiveTotalPaise,
  });
  const whatsappUrl = whatsappAvailable ? whatsappOrderUrl(siteConfig.whatsappNumber, orderMessage) : '';

  // The server saved the order.
  if (placed) {
    const placedTotal = formatINR(Math.round(parseFloat(placed.total) * 100));
    const collect = placed.fulfillment_type === 'SCHOOL_PICKUP';
    const isOnline = placed.payment_method === 'ONLINE';
    return (
      <div className="order-confirmed-wrap container">
        <div className="order-confirmed-card">
          <h1 className="confirmed-heading">
            {isOnline ? t('co.paymentSuccess', { n: placed.order_number }) : t('co.placed.title')}
          </h1>
          <div className="order-num-label">{t('co.placed.number', { n: placed.order_number })}</div>

          <div className="confirmed-steps">
            <div className="confirmed-step-row">
              <span className="step-circle">1</span>
              <span>
                {isOnline
                  ? t('co.placed.online', { n: placed.order_number })
                  : t('co.placed.saved', { name: placed.student_name || studentName })}
              </span>
            </div>
            <div className="confirmed-step-row">
              <span className="step-circle">2</span>
              <span>
                {collect
                  ? t('co.placed.collect', { school: school?.name || t('co.yourSchool'), total: placedTotal })
                  : t('co.placed.home', { total: placedTotal })}
              </span>
            </div>
            <div className="confirmed-step-row">
              <span className="step-circle">3</span>
              <span>{t('co.exchange')}</span>
            </div>
          </div>

          <div className="confirmed-actions">
            <Link to="/parent/orders" className="btn btn-primary">
              {t('co.placed.myOrders')}
            </Link>
            <Link to="/" className="btn btn-text">
              {t('co.backHome')}
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
          <h1 className="confirmed-heading">{t('co.wa.title')}</h1>
          <div className="order-num-label">{t('co.wa.ref', { ref: reference })}</div>

          <div className="confirmed-steps">
            <div className="confirmed-step-row">
              <span className="step-circle">1</span>
              <span>{t('co.wa.step1')}</span>
            </div>
            <div className="confirmed-step-row">
              <span className="step-circle">2</span>
              <span>
                {deliveryType === 'HOME'
                  ? t('co.wa.step2home', { mobile: parentMobile })
                  : t('co.wa.step2school', { mobile: parentMobile })}
              </span>
            </div>
            <div className="confirmed-step-row">
              <span className="step-circle">3</span>
              <span>{t('co.wa.step3', { total: formatINR(totalPaise) })}</span>
            </div>
          </div>

          <div className="confirmed-actions">
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
              {t('co.wa.again')}
            </a>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                clearCart();
                navigate('/');
              }}
            >
              {t('co.wa.sent')}
            </button>
            <button type="button" className="btn btn-text" onClick={() => setSentOnWhatsApp(false)}>
              {t('co.wa.change')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (cart.length === 0) {
    return (
      <div className="checkout-empty container">
        <h2>{t('bag.empty')}</h2>
        <p>{t('bag.emptySub')}</p>
        <Link to="/" className="btn btn-primary">
          {t('co.backHome')}
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
          <ArrowLeft width={16} height={16} /> {t('co.back')}
        </button>
        <h1 className="checkout-title">{t('co.title')}</h1>
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
              <h2 className="step-header-title">{t('co.s1')}</h2>
              {activeStep > 1 && <span className="step-edit-btn">{t('co.edit')}</span>}
            </div>

            {activeStep === 1 ? (
              <div className="step-body">
                {mode === 'account' ? (
                  <>
                    {!isParent ? (
                      <div className="checkout-signin">
                        <div>
                          <strong>{t('co.signin.title')}</strong>
                          <span>{t('co.signin.sub')}</span>
                        </div>
                        <button type="button" className="btn btn-primary" onClick={() => setSignInOpen(true)}>
                          {t('co.signin.btn')}
                        </button>
                      </div>
                    ) : child ? (
                      <div className="checkout-child">
                        <span>{t('co.orderingFor')}</span>
                        <strong>{child.name}</strong>
                        <span>
                          {[classLabel(child.grade_name || child.class_name, t), child.section && t('co.section', { s: child.section })]
                            .filter(Boolean)
                            .join(' · ')}{' '}
                          · {child.school_name}
                        </span>
                        {parentMobile && <span>{t('co.verified', { mobile: `${parentMobile.slice(0, 5)} ${parentMobile.slice(5)}` })}</span>}
                        <button type="button" className="psi-link" onClick={() => setSignInOpen(true)}>
                          {t('nav.change')}
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="btn btn-primary" onClick={() => setSignInOpen(true)}>
                        {t('co.chooseChild')}
                      </button>
                    )}

                    {wrongSchool && (
                      <p className="field-err" role="alert">
                        {t('co.wrongSchool', { bagSchool: selection?.schoolName ?? '', name: child?.name ?? '', childSchool: child?.school_name ?? '' })}
                      </p>
                    )}
                    {errors.child && !wrongSchool && <span className="field-err">{errors.child}</span>}

                    {isParent && (
                      <div className="form-group">
                        <label className="input-label" htmlFor="parent-name">{t('co.yourName')}</label>
                        <input
                          id="parent-name"
                          type="text"
                          autoComplete="name"
                          className={`input-control ${errors.parentName ? 'input-has-err' : ''}`}
                          placeholder={t('co.namePlaceholder')}
                          value={parentName}
                          onChange={(e) => setParentName(e.target.value)}
                        />
                        {errors.parentName && <span className="field-err">{errors.parentName}</span>}
                      </div>
                    )}

                    {whatsappAvailable && !child && (
                      <button type="button" className="psi-link" onClick={() => setMode('whatsapp')}>
                        {t('co.useWhatsApp')}
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <div className="form-grid-2">
                      <div className="form-group">
                        <label className="input-label" htmlFor="parent-name">{t('co.yourName')}</label>
                        <input
                          id="parent-name"
                          type="text"
                          autoComplete="name"
                          className={`input-control ${errors.parentName ? 'input-has-err' : ''}`}
                          placeholder={t('co.namePlaceholder')}
                          value={parentName}
                          onChange={(e) => setParentName(e.target.value)}
                        />
                        {errors.parentName && <span className="field-err">{errors.parentName}</span>}
                      </div>

                      <div className="form-group">
                        <label className="input-label" htmlFor="parent-mobile">{t('co.mobile')}</label>
                        <input
                          id="parent-mobile"
                          type="tel"
                          inputMode="numeric"
                          autoComplete="tel"
                          maxLength={10}
                          className={`input-control ${errors.parentMobile ? 'input-has-err' : ''}`}
                          placeholder={t('co.mobilePlaceholder')}
                          value={parentMobile}
                          onChange={(e) => setParentMobile(e.target.value.replace(/\D/g, ''))}
                        />
                        {errors.parentMobile && <span className="field-err">{errors.parentMobile}</span>}
                      </div>
                    </div>

                    <div className="form-grid-2">
                      <div className="form-group">
                        <label className="input-label" htmlFor="student-name">{t('co.childName')}</label>
                        <input
                          id="student-name"
                          type="text"
                          className={`input-control ${errors.studentName ? 'input-has-err' : ''}`}
                          placeholder={t('co.childNamePlaceholder')}
                          value={studentName}
                          onChange={(e) => setStudentName(e.target.value)}
                        />
                        {errors.studentName && <span className="field-err">{errors.studentName}</span>}
                      </div>

                      <div className="form-group">
                        <label className="input-label" htmlFor="student-class">{t('co.class')}</label>
                        <input
                          id="student-class"
                          type="text"
                          className={`input-control ${errors.studentClass ? 'input-has-err' : ''}`}
                          placeholder={t('co.classPlaceholder')}
                          value={studentClass}
                          onChange={(e) => setStudentClass(e.target.value)}
                        />
                        {errors.studentClass && <span className="field-err">{errors.studentClass}</span>}
                      </div>
                    </div>

                    <button type="button" className="psi-link" onClick={() => setMode('account')}>
                      {t('co.useSignIn')}
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
                  {t('co.next')}
                </button>
              </div>
            ) : (
              <div className="step-summary-view">
                <span>{parentName} · {parentMobile}</span>
                <span>{t('co.summaryChild', { name: studentName, cls: studentClass })}</span>
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
              <h2 className="step-header-title">{t('co.s2')}</h2>
              {activeStep > 2 && <span className="step-edit-btn">{t('co.edit')}</span>}
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
                        <strong>{t('co.home')}</strong>
                        <p>{t('co.homeSub')}</p>
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
                        <strong>{t('co.collect')}</strong>
                        <p>{t('co.collectSub', { school: school?.name || t('co.yourSchool') })}</p>
                      </div>
                    </label>
                  )}
                </div>

                {deliveryType === 'HOME' && (
                  <div className="address-form-fields">
                    <div className="form-grid-2">
                      <div className="form-group">
                        <label className="input-label" htmlFor="pincode">{t('co.pin')}</label>
                        <input
                          id="pincode"
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          autoComplete="postal-code"
                          className={`input-control ${errors.pinCode ? 'input-has-err' : ''}`}
                          placeholder={t('co.pinPlaceholder')}
                          value={pinCode}
                          onChange={(e) => handlePinChange(e.target.value)}
                        />
                        {errors.pinCode && <span className="field-err">{errors.pinCode}</span>}
                        {pinLookupLoading && (
                          <span className="field-hint" style={{ color: 'var(--ink-soft)' }}>
                            {t('co.pinChecking')}
                          </span>
                        )}
                        {!errors.pinCode && !pinLookupLoading && serviceability && (
                          <span
                            className="field-hint"
                            style={{
                              color:
                                serviceability.status === 'SERVICEABLE'
                                  ? 'var(--brand-deep)'
                                  : serviceability.status === 'UNSERVICEABLE'
                                  ? 'var(--danger)'
                                  : 'var(--ink-soft)',
                            }}
                          >
                            {serviceability.status === 'SERVICEABLE'
                              ? t('co.pinServiceable')
                              : serviceability.status === 'UNSERVICEABLE'
                              ? t('co.pinUnserviceable')
                              : t('co.pinUnknown')}
                          </span>
                        )}
                      </div>

                      <div className="form-group">
                        <label className="input-label" htmlFor="city">{t('co.city')}</label>
                        <input
                          id="city"
                          type="text"
                          autoComplete="address-level2"
                          className={`input-control ${errors.city ? 'input-has-err' : ''}`}
                          value={city}
                          onChange={(e) => {
                            setCity(e.target.value);
                            setCityTouched(true);
                          }}
                        />
                        {errors.city && <span className="field-err">{errors.city}</span>}
                      </div>
                    </div>

                    <div className="form-group">
                      <label className="input-label" htmlFor="state">{t('co.state')}</label>
                      <select
                        id="state"
                        autoComplete="address-level1"
                        className={`input-control ${errors.state ? 'input-has-err' : ''}`}
                        value={state}
                        onChange={(e) => {
                          setState(e.target.value);
                          setStateTouched(true);
                        }}
                      >
                        <option value="">{t('co.selectState')}</option>
                        {INDIAN_STATES_AND_UTS.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                      {errors.state && <span className="field-err">{errors.state}</span>}
                    </div>

                    <div className="form-group">
                      <label className="input-label" htmlFor="addr-1">{t('co.addr1')}</label>
                      <input
                        id="addr-1"
                        type="text"
                        autoComplete="street-address"
                        className={`input-control ${errors.addressLine1 ? 'input-has-err' : ''}`}
                        placeholder={t('co.addr1Placeholder')}
                        value={addressLine1}
                        onChange={(e) => setAddressLine1(e.target.value)}
                      />
                      {errors.addressLine1 && <span className="field-err">{errors.addressLine1}</span>}
                    </div>

                    <div className="form-group">
                      <label className="input-label" htmlFor="addr-2">{t('co.addr2')}</label>
                      <input
                        id="addr-2"
                        type="text"
                        className="input-control"
                        placeholder={t('co.addr2Placeholder')}
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
                  {t('co.next')}
                </button>
              </div>
            ) : activeStep > 2 ? (
              <div className="step-summary-view">
                <span>
                  {deliveryType === 'HOME'
                    ? t('co.summaryHome', { address: `${addressLine1}, ${city} (${pinCode})` })
                    : t('co.summaryCollect', { school: school?.name || t('co.yourSchool') })}
                </span>
              </div>
            ) : null}
          </section>

          {/* Section 3: Payment */}
          <section className={`checkout-section ${activeStep === 3 ? 'is-active' : 'is-collapsed'}`}>
            <div className="section-step-header">
              <div className="step-badge">3</div>
              <h2 className="step-header-title">{t('co.s3')}</h2>
            </div>

            {activeStep === 3 && (
              <div className="step-body">
                {priceNotice && (
                  <div className="checkout-notice-banner" role="alert">
                    {priceNotice}
                  </div>
                )}

                {quoteLoading ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
                    <div className="checkout-skeleton" style={{ height: 56 }} />
                    <div className="checkout-skeleton" style={{ height: 56 }} />
                  </div>
                ) : (
                  <div className="delivery-radio-group" style={{ marginBottom: 'var(--space-4)' }}>
                    {quote?.payment_methods.includes('ONLINE') && (
                      <label className={`delivery-radio-card ${selectedMethod === 'ONLINE' ? 'is-selected' : ''}`}>
                        <input
                          type="radio"
                          name="paymentMethod"
                          value="ONLINE"
                          checked={selectedMethod === 'ONLINE'}
                          onChange={() => setSelectedMethod('ONLINE')}
                          disabled={paymentStep === 'checking' || paymentStep === 'confirming'}
                        />
                        <div>
                          <strong>{t('co.method.online')}</strong>
                          <p>{t('co.legal')}</p>
                        </div>
                      </label>
                    )}
                    <label className={`delivery-radio-card ${selectedMethod === 'COD' ? 'is-selected' : ''}`}>
                      <input
                        type="radio"
                        name="paymentMethod"
                        value="COD"
                        checked={selectedMethod === 'COD'}
                        onChange={() => setSelectedMethod('COD')}
                        disabled={paymentStep === 'checking' || paymentStep === 'confirming'}
                      />
                      <div>
                        <strong>{t('co.method.cod')}</strong>
                        <p>{t('co.cashSub')}</p>
                      </div>
                    </label>
                  </div>
                )}

                {paymentStep === 'checking' && (
                  <div className="checkout-status-card" role="status">
                    <h3>{t('co.checkingPayment')}</h3>
                    {inProgressWarning ? (
                      <>
                        <p>{t('co.paymentInProgress')}</p>
                        <button
                          type="button"
                          className="btn btn-outline"
                          onClick={() => onlineOrder && handleReconcile(onlineOrder.id)}
                        >
                          {t('co.checkAgain')}
                        </button>
                      </>
                    ) : (
                      <p>{t('co.checkingPayment')}</p>
                    )}
                  </div>
                )}

                {paymentStep === 'confirming' && (
                  <div className="checkout-status-card" role="status">
                    <h3>{t('co.confirmingPayment')}</h3>
                    {willTextMessage && <p>{t('co.willText')}</p>}
                  </div>
                )}

                {paymentStep === 'failed' && (
                  <div className="checkout-status-card" role="status">
                    {lastAttemptReason && <p>{lastAttemptReason}</p>}
                    <div className="checkout-action-row">
                      {!inProgressWarning && (
                        <>
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => onlineOrder && initiateOnlinePayment(onlineOrder)}
                          >
                            {t('co.tryAgain')}
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline"
                            onClick={handleSwitchToCod}
                          >
                            {t('co.switchToCod')}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {paymentStep === 'idle' && (
                  <>
                    {mode === 'account' ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-primary pay-now-btn"
                          onClick={handlePlaceOrder}
                          disabled={placing || quoteLoading}
                          aria-busy={placing}
                        >
                          {placing
                            ? retrying
                              ? t('co.retrying')
                              : t('co.placing')
                            : selectedMethod === 'ONLINE'
                            ? `${t('co.payNow')} · ${formatINR(effectiveTotalPaise)}`
                            : t('co.place', { total: formatINR(effectiveTotalPaise) })}
                        </button>
                        {orderError && (
                          <p className="field-err checkout-order-error" role="alert">
                            {orderError}
                          </p>
                        )}
                        <p className="checkout-legal-note">
                          {t('co.legal')} <Link to="/terms">{t('co.terms')}</Link> · <Link to="/refunds">{t('co.refunds')}</Link> ·{' '}
                          <Link to="/privacy">{t('co.privacy')}</Link>
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
                            scrollPageTo(0);
                          }}
                        >
                          {t('co.wa.send', { total: formatINR(effectiveTotalPaise) })}
                        </a>
                        <p className="checkout-legal-note">
                          {t('co.wa.note')} {t('co.legal')} <Link to="/terms">{t('co.terms')}</Link> ·{' '}
                          <Link to="/refunds">{t('co.refunds')}</Link> · <Link to="/privacy">{t('co.privacy')}</Link>
                        </p>
                      </>
                    ) : (
                      <p className="checkout-closed-note" role="status">
                        {t('co.closed')}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </section>
        </div>

        {/* Right Column: Sticky Order Summary */}
        <aside className="checkout-summary-col">
          <div className="order-summary-box">
            <h3 className="summary-title">{t('co.summary')}</h3>

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
                <span>{t('co.delivery')}</span>
                <span>{t('co.free')}</span>
              </div>

              <div className="math-total-row">
                <span>{t('bag.total')}</span>
                <span className="total-amount">{formatINR(effectiveTotalPaise)}</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
