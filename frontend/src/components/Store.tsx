import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, Product, Order, CustomisationField } from '../api';
import { CustomisationForm } from './CustomisationForm';

const demo: Product[] = [
  {
    id: 'u',
    name: 'Classic white shirt',
    category: 'Uniforms',
    price: 650,
    variants: [
      { id: 'u1', size: '28', stock_status: 'IN_STOCK' },
      { id: 'u2', size: '30', stock_status: 'IN_STOCK' },
      { id: 'u3', size: '32', stock_status: 'LOW_STOCK' },
    ],
  },
  {
    id: 's',
    name: 'Black lace-up shoes',
    category: 'Shoes',
    price: 1100,
    variants: [
      { id: 's1', size: '3', stock_status: 'IN_STOCK' },
      { id: 's2', size: '4', stock_status: 'IN_STOCK' },
    ],
  },
  {
    id: 'st',
    name: 'Personalised Photo Notebook Pack (Set of 6)',
    category: 'Stationery',
    price: 360,
    customisation_schema: [
      {
        key: 'cover_photo',
        label: 'Front Cover Photo',
        type: 'image',
        required: true,
        limits: { max_bytes: 1048576, accept: ['image/jpeg', 'image/png', 'image/webp'] },
      },
      {
        key: 'printed_student_name',
        label: 'Name to Print on Cover',
        type: 'text',
        required: true,
        max_length: 60,
      },
    ],
    variants: [
      { id: 'st1', size: 'A4 Single Line (Pack of 6)', stock_status: 'IN_STOCK' },
      { id: 'st2', size: 'A4 Unruled (Pack of 6)', stock_status: 'IN_STOCK' },
    ],
  },
  {
    id: 'i',
    name: 'Smart RFID PVC Student ID Card with Lanyard',
    category: 'ID Cards',
    price: 120,
    customisation_schema: [
      {
        key: 'student_photo',
        label: 'Student Passport Photo',
        type: 'image',
        required: true,
        limits: { max_bytes: 1048576, accept: ['image/jpeg', 'image/png', 'image/webp'] },
      },
      {
        key: 'student_name',
        label: 'Full Name (on ID)',
        type: 'text',
        required: true,
        max_length: 60,
      },
      {
        key: 'student_class',
        label: 'Class & Section',
        type: 'text',
        required: true,
        max_length: 20,
      },
      {
        key: 'blood_group',
        label: 'Blood Group',
        type: 'select',
        required: true,
        options: ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'],
      },
      {
        key: 'emergency_phone',
        label: 'Emergency Contact Phone',
        type: 'text',
        required: false,
        max_length: 15,
      },
    ],
    variants: [
      { id: 'i1', size: 'Standard CR80 + Lanyard', stock_status: 'IN_STOCK' },
    ],
  },
];

const stockLabel = (s: Product['variants'][number]['stock_status']) =>
  s === null ? 'stock depends on school' : s === 'IN_STOCK' ? 'in stock' : s === 'LOW_STOCK' ? 'low stock' : 'out of stock';

export function Catalogue({
  student,
  studentId,
  onOrder,
  publicView,
}: {
  student?: string;
  studentId?: string;
  onOrder?: (x: { product: Product; variantId: string; customisationData: Record<string, any> }) => void;
  publicView?: boolean;
}) {
  const [c, setC] = useState('All');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string>('');
  const [customValues, setCustomValues] = useState<Record<string, any>>({});
  const [formError, setFormError] = useState<string>('');

  const { data, isError, isLoading } = useQuery({
    queryKey: ['catalogue', publicView ? 'public' : studentId || student],
    queryFn: async () => {
      if (publicView) {
        const res = await api<{ results: Product[] }>('/public/products/');
        return res.results;
      }
      if (studentId) {
        const res = await api<{ products: Product[] }>(`/catalog/students/${studentId}/products/`).catch(() => null);
        if (res?.products) return res.products;
      }
      return api<Product[]>('/products/?student=' + student).catch(() => demo);
    },
    retry: publicView ? 1 : false,
  });

  const list = (data || (publicView ? [] : demo)).filter((x) => c === 'All' || x.category === c);

  const openProductCustomisation = (p: Product, variantId?: string) => {
    setSelectedProduct(p);
    setSelectedVariantId(variantId || p.variants[0]?.id || '');
    setCustomValues({});
    setFormError('');
  };

  const schemaList: CustomisationField[] = useMemo(() => {
    if (!selectedProduct?.customisation_schema) return [];
    if (Array.isArray(selectedProduct.customisation_schema)) {
      return selectedProduct.customisation_schema;
    }
    if (typeof selectedProduct.customisation_schema === 'object' && selectedProduct.customisation_schema.fields) {
      return selectedProduct.customisation_schema.fields;
    }
    return [];
  }, [selectedProduct]);

  const handleAddToCart = () => {
    if (!selectedProduct) return;
    if (!selectedVariantId) {
      setFormError('Please select a size/variant.');
      return;
    }

    // Validate required fields in schema
    for (const f of schemaList) {
      if (f.required && !customValues[f.key]) {
        setFormError(`Please fill in required customisation: ${f.label}`);
        return;
      }
    }

    onOrder?.({
      product: selectedProduct,
      variantId: selectedVariantId,
      customisationData: customValues,
    });
    setSelectedProduct(null);
  };

  return (
    <section>
      <div className="section-row">
        <div>
          <div className="eyebrow">{publicView ? 'OUR CATALOGUE' : 'SHOPPING FOR'}</div>
          <h2>{publicView ? 'Browse the store' : student}</h2>
        </div>
        <span className="pill">{list.length} items</span>
      </div>

      <div className="chips">
        {['All', 'Uniforms', 'Shoes', 'Stationery', 'ID Cards'].map((x) => (
          <button className={c === x ? 'chip active' : 'chip'} onClick={() => setC(x)} key={x}>
            {x}
          </button>
        ))}
      </div>

      {publicView && isLoading && (
        <div className="empty">
          <h3>Loading the catalogue…</h3>
          <p>The server may take a moment to wake up.</p>
        </div>
      )}
      {publicView && isError && (
        <div className="empty">
          <h3>Couldn't load the catalogue</h3>
          <p>Please refresh and try again.</p>
        </div>
      )}

      <div className="product-grid">
        {list.map((p) => {
          const hasCustom =
            p.customisation_schema &&
            ((Array.isArray(p.customisation_schema) && p.customisation_schema.length > 0) ||
              (typeof p.customisation_schema === 'object' &&
                (p.customisation_schema as any).fields?.length > 0));

          return (
            <article className="product" key={p.id}>
              <div className={'product-image ' + p.category.toLowerCase().replace(' ', '-')}>
                {p.category === 'Shoes' ? '◒' : p.category === 'Stationery' ? '▤' : p.category === 'ID Cards' ? '▧' : '▥'}
              </div>
              <div className="product-body">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="tag">{p.category}</span>
                  {hasCustom && (
                    <span className="badge s-confirmed" style={{ fontSize: '10px' }}>
                      ✦ Personalised
                    </span>
                  )}
                </div>
                <h3>{p.name}</h3>
                <strong>₹{p.price.toLocaleString('en-IN')}</strong>

                {publicView ? (
                  <Link className="secondary" to="/login">
                    Sign in to order <span>→</span>
                  </Link>
                ) : (
                  <button
                    className="secondary"
                    onClick={() => openProductCustomisation(p)}
                  >
                    {hasCustom ? 'Personalise & Add ✦' : 'Add to cart +'}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {/* Product Customisation Modal */}
      {selectedProduct && (
        <div className="modal-backdrop" onClick={() => setSelectedProduct(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(580px, 100%)', padding: '24px' }}>
            <div className="card-head" style={{ marginBottom: '16px' }}>
              <div>
                <h2>{selectedProduct.name}</h2>
                <div className="muted" style={{ fontSize: '12px' }}>
                  {selectedProduct.category} · ₹{selectedProduct.price.toLocaleString('en-IN')}
                </div>
              </div>
              <button className="icon-btn" onClick={() => setSelectedProduct(null)}>
                ✕
              </button>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'grid', gap: '6px', fontSize: '12px', color: '#5c6b61', fontWeight: 600 }}>
                <span>Select Size / Variant <span style={{ color: '#a34235' }}>*</span></span>
                <select
                  value={selectedVariantId}
                  onChange={(e) => setSelectedVariantId(e.target.value)}
                  style={{
                    border: '1px solid #c9d4c9',
                    borderRadius: '8px',
                    padding: '10px',
                    fontSize: '13px',
                    background: '#fff',
                  }}
                >
                  <option value="" disabled>Choose size</option>
                  {selectedProduct.variants.map((v) => (
                    <option key={v.id} value={v.id} disabled={v.stock_status === 'OUT_OF_STOCK'}>
                      {v.size} · {stockLabel(v.stock_status)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Dynamic Customisation Form rendered directly from customisation_schema */}
            {schemaList.length > 0 && (
              <CustomisationForm
                schema={schemaList}
                values={customValues}
                onChange={setCustomValues}
              />
            )}

            {formError && (
              <div style={{ color: '#a34235', fontSize: '12px', marginBottom: '14px', fontWeight: 600 }}>
                {formError}
              </div>
            )}

            <div className="modal-actions" style={{ marginTop: '20px' }}>
              <button type="button" className="secondary" onClick={() => setSelectedProduct(null)}>
                Cancel
              </button>
              <button type="button" className="primary" onClick={handleAddToCart}>
                Save &amp; Add to Cart →
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export interface CartItem {
  id: string;
  product: Product;
  variantId: string;
  variantSize?: string;
  quantity: number;
  customisationData?: Record<string, any>;
}

export function Cart({
  items,
  product,
  variantId,
  customisationData,
  studentId,
  onClear,
  onRemoveItem,
  onSuccess,
}: {
  items?: CartItem[];
  product?: Product | null;
  variantId?: string;
  customisationData?: Record<string, any>;
  studentId?: string;
  onClear: () => void;
  onRemoveItem?: (id: string) => void;
  onSuccess?: () => void;
}) {
  const [busy, setBusy] = useState(false);

  // Normalize single item vs multi items
  const activeItems: CartItem[] = useMemo(() => {
    if (items && items.length > 0) return items;
    if (product) {
      const vId = variantId || product.variants[0]?.id || '';
      return [
        {
          id: 'single',
          product,
          variantId: vId,
          variantSize: product.variants.find((v) => v.id === vId)?.size,
          quantity: 1,
          customisationData,
        },
      ];
    }
    return [];
  }, [items, product, variantId, customisationData]);

  if (activeItems.length === 0)
    return (
      <div className="empty">
        <span>✦</span>
        <h3>Your cart is light</h3>
        <p>Add something from the catalogue to get started.</p>
      </div>
    );

  const totalAmount = activeItems.reduce(
    (sum, item) => sum + item.product.price * (item.quantity || 1),
    0
  );

  async function checkout() {
    for (const item of activeItems) {
      if (!item.variantId) {
        alert(`Please select a size/variant for ${item.product.name}.`);
        return;
      }
    }

    setBusy(true);
    try {
      const payloadItems = activeItems.map((item) => {
        const cleanCustomData: Record<string, any> = {};
        if (item.customisationData) {
          Object.entries(item.customisationData).forEach(([k, v]) => {
            if (v !== undefined && v !== null && v !== '') {
              cleanCustomData[k] = v;
            }
          });
        }
        return {
          variant: item.variantId,
          quantity: item.quantity || 1,
          customisation_data: cleanCustomData,
        };
      });

      await api('/orders/', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          idempotency_key: crypto.randomUUID(),
          student: studentId || 'selected',
          items: payloadItems,
        }),
      });
      alert('Order placed successfully!');
      onClear();
      onSuccess?.();
    } catch (err: any) {
      alert(err.message || 'Connect the selected student and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cart-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <span className="eyebrow">{activeItems.length} {activeItems.length === 1 ? 'ITEM' : 'ITEMS'} IN CART</span>
        {activeItems.length > 1 && (
          <button className="link-button" onClick={onClear} style={{ fontSize: '11px', color: '#888' }}>
            Clear all
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
        {activeItems.map((item) => {
          const hasCustom = item.customisationData && Object.keys(item.customisationData).length > 0;
          return (
            <div
              key={item.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                padding: '8px 10px',
                background: '#f9fbf9',
                borderRadius: '8px',
                border: '1px solid #e2ece5',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <strong style={{ fontSize: '13px' }}>{item.product.name}</strong>
                  {item.product.category && (
                    <span
                      style={{
                        fontSize: '10px',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        background: '#e9f1ec',
                        color: '#275b4c',
                        fontWeight: 600,
                      }}
                    >
                      {item.product.category}
                    </span>
                  )}
                </div>
                <div className="muted" style={{ fontSize: '12px' }}>
                  {item.variantSize ? `Size: ${item.variantSize} · ` : ''}₹{item.product.price} × {item.quantity || 1}
                </div>
                {hasCustom && (
                  <div style={{ fontSize: '11px', color: '#2a6a4e', marginTop: '2px' }}>
                    ✦ Customised
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                <span style={{ fontWeight: 700, fontSize: '13px' }}>
                  ₹{(item.product.price * (item.quantity || 1)).toLocaleString('en-IN')}
                </span>
                {onRemoveItem && item.id !== 'single' && (
                  <button
                    className="link-button"
                    style={{ fontSize: '11px', color: '#a34235', padding: 0 }}
                    onClick={() => onRemoveItem(item.id)}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #dfe5dd', paddingTop: '10px', marginBottom: '12px' }}>
        <span style={{ fontWeight: 600, fontSize: '14px' }}>Total Amount</span>
        <strong style={{ fontSize: '18px', color: '#275b4c' }}>₹{totalAmount.toLocaleString('en-IN')}</strong>
      </div>

      <button className="primary full" disabled={busy} onClick={checkout}>
        {busy ? 'Processing…' : `Pay securely · ₹${totalAmount.toLocaleString('en-IN')}`}
      </button>

      {activeItems.length === 1 && (
        <button className="link-button" onClick={onClear} style={{ marginTop: '8px' }}>
          Remove item
        </button>
      )}
    </div>
  );
}

export function Timeline({ order }: { order: Order }) {
  const steps = ['PLACED', 'CONFIRMED', 'PACKED', 'DISPATCHED', 'DELIVERED'];
  return (
    <div className="timeline">
      {steps.map((s, i) => {
        const orderIdx = steps.indexOf(order.status);
        const isCurrent = order.status === s;
        const isDone = orderIdx >= i;
        return (
          <div className={(isCurrent ? 'current ' : '') + (isDone ? 'done' : '')} key={s}>
            <span>{i + 1}</span>
            <div>
              <b>{s[0] + s.slice(1).toLowerCase()}</b>
              <small>{isCurrent ? 'In progress' : ' '}</small>
            </div>
          </div>
        );
      })}
    </div>
  );
}
