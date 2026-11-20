import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { portalApi, type PortalProduct, type ProductCityPrice } from '../../api';
import { useAuth } from '../../auth';
import { Search, Plus, X, Package, Receipt, RefreshCw, Check } from '../ui/icons';

export function CityPricingView() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const isCityAdmin = user?.role === 'ADMIN' && Boolean(user?.city);
  const [selectedCityId, setSelectedCityId] = useState<string>(user?.city || '');
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  // Modal State for setting/editing city price
  const [modalOpen, setModalOpen] = useState(false);
  const [targetProduct, setTargetProduct] = useState<PortalProduct | null>(null);
  const [priceInput, setPriceInput] = useState<string>('');
  const [modalError, setModalError] = useState('');
  const [modalSuccess, setModalSuccess] = useState('');

  // 1. Fetch Cities
  const { data: citiesData } = useQuery({
    queryKey: ['portal-cities'],
    queryFn: () => portalApi.cities(),
  });
  const cities = citiesData?.results ?? [];

  // Active City ID
  const activeCityId = selectedCityId || (isCityAdmin ? user?.city || '' : cities[0]?.id || '');
  const activeCity = cities.find((c) => c.id === activeCityId);

  // 2. Fetch Schools
  const { data: schoolsData } = useQuery({
    queryKey: ['portal-schools-all'],
    queryFn: () => portalApi.schools({ page_size: '100' }),
  });
  const schools = schoolsData?.results ?? [];

  // 3. Fetch Categories
  const { data: categoriesData } = useQuery({
    queryKey: ['portal-categories'],
    queryFn: () => portalApi.categories(),
  });
  const categories = categoriesData?.results ?? [];

  // 4. Fetch Universal Products (Organized list, NOT split by sizes!)
  const { data: productsData, isLoading: productsLoading } = useQuery({
    queryKey: ['portal-pricing-products', selectedSchoolId, categoryFilter],
    queryFn: () => {
      const p: Record<string, string> = { page_size: '100', active: 'true' };
      if (selectedSchoolId) p.school = selectedSchoolId;
      if (categoryFilter) p.category = categoryFilter;
      return portalApi.products(p);
    },
  });
  const products = productsData?.results ?? [];

  // 5. Fetch City Price Overrides for active city
  const { data: cityPricesData, isLoading: pricesLoading } = useQuery({
    queryKey: ['portal-city-prices', activeCityId],
    queryFn: () => portalApi.cityPrices({ city: activeCityId, page_size: '100' }),
    enabled: Boolean(activeCityId),
  });
  const cityPricesList = cityPricesData?.results ?? [];

  // Map of product.id -> ProductCityPrice
  const cityPriceMap = useMemo(() => {
    const map = new Map<string, ProductCityPrice>();
    for (const cp of cityPricesList) {
      map.set(cp.product, cp);
    }
    return map;
  }, [cityPricesList]);

  // Set/Update City Price Mutation
  const setPriceMutation = useMutation({
    mutationFn: (body: { product: string; city: string; selling_price: string }) =>
      portalApi.setCityPrice(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-city-prices', activeCityId] });
      setModalSuccess('City price saved successfully.');
      setTimeout(() => {
        setModalOpen(false);
        setModalSuccess('');
      }, 700);
    },
    onError: (err: any) => {
      setModalError(err?.message || 'Failed to save city price.');
    },
  });

  // Delete City Price Override Mutation (Revert to universal)
  const deletePriceMutation = useMutation({
    mutationFn: (overrideId: string) => portalApi.deleteCityPrice(overrideId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-city-prices', activeCityId] });
    },
  });

  // Filter products by search text
  const filteredProducts = useMemo(() => {
    let list = products;
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description?.toLowerCase().includes(q) ||
          p.school_name?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [products, search]);

  const handleOpenSetPrice = (product: PortalProduct) => {
    setTargetProduct(product);
    const existing = cityPriceMap.get(product.id);
    setPriceInput(existing ? String(existing.selling_price) : String(product.selling_price));
    setModalError('');
    setModalSuccess('');
    setModalOpen(true);
  };

  const handleSavePrice = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetProduct || !activeCityId) return;
    const val = parseFloat(priceInput);
    if (isNaN(val) || val <= 0) {
      setModalError('Please enter a valid positive price.');
      return;
    }
    setModalError('');
    setPriceMutation.mutate({
      product: targetProduct.id,
      city: activeCityId,
      selling_price: val.toFixed(2),
    });
  };

  const handleResetToUniversal = (product: PortalProduct) => {
    const existing = cityPriceMap.get(product.id);
    if (!existing) return;
    if (confirm(`Reset "${product.name}" in ${activeCity?.name || 'this city'} back to the universal price of ₹${product.selling_price}?`)) {
      deletePriceMutation.mutate(existing.id);
    }
  };

  // Delta calculation for modal
  const inputDelta = useMemo(() => {
    if (!targetProduct || !priceInput) return 0;
    const universal = parseFloat(String(targetProduct.selling_price));
    const entered = parseFloat(priceInput);
    if (isNaN(universal) || isNaN(entered)) return 0;
    return entered - universal;
  }, [targetProduct, priceInput]);

  return (
    <div className="portal-content">
      {/* Top Banner / Explainer */}
      <div className="portal-section-header">
        <div>
          <h2>City Pricing & Custom Allocations</h2>
          <p>
            Products are listed universally by default. Select any city to customize local selling prices (e.g. +₹50 in Jaipur).
            Items without an override automatically use the universal rate.
          </p>
        </div>
      </div>

      {/* Control Bar: City, School, Category, Search */}
      <div className="portal-filter-bar">
        {/* City Selector */}
        <div className="portal-filter-item">
          <label htmlFor="price-city-select">Select City</label>
          <select
            id="price-city-select"
            value={activeCityId}
            onChange={(e) => setSelectedCityId(e.target.value)}
            disabled={isCityAdmin}
            className="portal-input"
          >
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.state})
              </option>
            ))}
          </select>
        </div>

        {/* School Selector */}
        <div className="portal-filter-item">
          <label htmlFor="price-school-select">Filter by School</label>
          <select
            id="price-school-select"
            value={selectedSchoolId}
            onChange={(e) => setSelectedSchoolId(e.target.value)}
            className="portal-input"
          >
            <option value="">All Schools & Universal Items</option>
            {schools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.code})
              </option>
            ))}
          </select>
        </div>

        {/* Category Filter */}
        <div className="portal-filter-item">
          <label htmlFor="price-cat-select">Category</label>
          <select
            id="price-cat-select"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="portal-input"
          >
            <option value="">All Categories</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>

        {/* Search Input */}
        <div className="portal-filter-item portal-filter-search" style={{ flexGrow: 1 }}>
          <label htmlFor="price-search-input">Search Products</label>
          <div className="portal-search-wrapper">
            <Search width={15} height={15} />
            <input
              id="price-search-input"
              type="text"
              placeholder="Search by product name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="portal-input"
            />
          </div>
        </div>
      </div>

      {/* Active City Pricing Status Card */}
      <div className="portal-stats-bar" style={{ display: 'flex', gap: '16px', marginBottom: '20px' }}>
        <div className="portal-stat-pill">
          <span className="muted">Managing City:</span>
          <strong>{activeCity?.name || 'All India'} ({activeCity?.state || 'HQ'})</strong>
        </div>
        <div className="portal-stat-pill">
          <span className="muted">Total Products:</span>
          <strong>{filteredProducts.length}</strong>
        </div>
        <div className="portal-stat-pill">
          <span className="muted">City Custom Overrides:</span>
          <strong style={{ color: cityPricesList.length > 0 ? '#15803d' : '#475569' }}>
            {cityPricesList.length} items customized
          </strong>
        </div>
      </div>

      {/* Products Table (Organized by Product, eliminating excessive size scrolling!) */}
      <div className="portal-card">
        {productsLoading || pricesLoading ? (
          <div className="portal-loading">
            <RefreshCw width={20} height={20} className="spin" />
            <span>Loading catalogue and city prices…</span>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="portal-empty">
            <Package width={32} height={32} />
            <p>No products match your current filters.</p>
          </div>
        ) : (
          <div className="portal-table-wrapper">
            <table className="portal-table">
              <thead>
                <tr>
                  <th style={{ width: '60px' }}>Photo</th>
                  <th>Product & School</th>
                  <th>Category / Band</th>
                  <th style={{ textAlign: 'right' }}>Universal Price</th>
                  <th style={{ textAlign: 'right' }}>{activeCity?.name || 'City'} Price</th>
                  <th style={{ textAlign: 'center' }}>Price Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product) => {
                  const override = cityPriceMap.get(product.id);
                  const isCustomized = Boolean(override);
                  const effectivePrice = isCustomized ? override!.selling_price : product.selling_price;
                  const delta = isCustomized
                    ? parseFloat(String(override!.selling_price)) - parseFloat(String(product.selling_price))
                    : 0;

                  return (
                    <tr key={product.id}>
                      {/* Photo Thumbnail */}
                      <td>
                        {product.images && product.images.length > 0 ? (
                          <img
                            src={product.images[0]}
                            alt={product.name}
                            style={{
                              width: '42px',
                              height: '42px',
                              objectFit: 'cover',
                              borderRadius: '4px',
                              border: '1px solid var(--line, #DCE0E5)',
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: '42px',
                              height: '42px',
                              borderRadius: '4px',
                              background: '#f1f5f9',
                              border: '1px solid var(--line, #DCE0E5)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#94a3b8',
                            }}
                          >
                            <Package width={18} height={18} />
                          </div>
                        )}
                      </td>

                      {/* Product Name & School */}
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--ink, #1F2937)' }}>{product.name}</div>
                        <div style={{ fontSize: '12px', color: '#64748b' }}>
                          {product.school_name || 'Universal / Multi-School'}
                        </div>
                      </td>

                      {/* Category & Class Band */}
                      <td>
                        <span className="portal-badge" style={{ textTransform: 'capitalize' }}>
                          {product.category_name || 'Uniform'}
                        </span>
                        {product.class_from && product.class_to && (
                          <span className="portal-badge" style={{ marginLeft: '6px' }}>
                            Class {product.class_from}–{product.class_to}
                          </span>
                        )}
                      </td>

                      {/* Universal Base Price */}
                      <td style={{ textAlign: 'right', fontWeight: 500 }}>
                        ₹{parseFloat(String(product.selling_price)).toFixed(2)}
                      </td>

                      {/* Effective City Price */}
                      <td style={{ textAlign: 'right', fontWeight: 700, color: isCustomized ? '#15803d' : 'inherit' }}>
                        ₹{parseFloat(String(effectivePrice)).toFixed(2)}
                      </td>

                      {/* Status Badge */}
                      <td style={{ textAlign: 'center' }}>
                        {isCustomized ? (
                          <span
                            className="portal-badge"
                            style={{
                              background: delta >= 0 ? '#dcfce7' : '#fef3c7',
                              color: delta >= 0 ? '#15803d' : '#b45309',
                              border: `1px solid ${delta >= 0 ? '#bbf7d0' : '#fde68a'}`,
                              fontWeight: 600,
                            }}
                          >
                            {delta > 0
                              ? `+₹${delta.toFixed(2)} (${activeCity?.name})`
                              : delta < 0
                              ? `-₹${Math.abs(delta).toFixed(2)} (${activeCity?.name})`
                              : `Custom (${activeCity?.name})`}
                          </span>
                        ) : (
                          <span
                            className="portal-badge"
                            style={{ background: '#f8fafc', color: '#64748b', border: '1px solid #e2e8f0' }}
                          >
                            Universal Rate
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                          <button
                            type="button"
                            onClick={() => handleOpenSetPrice(product)}
                            className="portal-btn portal-btn-sm portal-btn-primary"
                          >
                            {isCustomized ? 'Edit City Price' : 'Set City Price'}
                          </button>
                          {isCustomized && (
                            <button
                              type="button"
                              onClick={() => handleResetToUniversal(product)}
                              className="portal-btn portal-btn-sm"
                              style={{
                                color: '#b91c1c',
                                borderColor: '#fecaca',
                                background: '#fff',
                              }}
                              title="Revert back to universal catalogue price"
                            >
                              Reset
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Set / Edit City Price Modal */}
      {modalOpen && targetProduct && (
        <div className="portal-modal-backdrop">
          <div className="portal-modal" style={{ maxWidth: '480px' }}>
            <div className="portal-modal-header">
              <div>
                <h3>Set City Price for {activeCity?.name}</h3>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
                  {targetProduct.name} ({targetProduct.school_name || 'Universal'})
                </p>
              </div>
              <button type="button" onClick={() => setModalOpen(false)} className="portal-modal-close">
                <X width={18} height={18} />
              </button>
            </div>

            <form onSubmit={handleSavePrice}>
              <div className="portal-modal-body">
                {modalError && <div className="portal-alert portal-alert-error">{modalError}</div>}
                {modalSuccess && <div className="portal-alert portal-alert-success">{modalSuccess}</div>}

                {/* Base Universal Price Display */}
                <div
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '4px',
                    padding: '12px',
                    marginBottom: '16px',
                  }}
                >
                  <div style={{ fontSize: '12px', color: '#64748b' }}>Universal Base Price</div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--ink, #1F2937)' }}>
                    ₹{parseFloat(String(targetProduct.selling_price)).toFixed(2)}
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                    Applied across all other cities in India unless explicitly overridden.
                  </div>
                </div>

                {/* City Selling Price Input */}
                <div className="portal-field">
                  <label htmlFor="city-price-input">
                    Selling Price in {activeCity?.name} (₹) *
                  </label>
                  <input
                    id="city-price-input"
                    type="number"
                    step="0.01"
                    min="1"
                    value={priceInput}
                    onChange={(e) => setPriceInput(e.target.value)}
                    required
                    className="portal-input"
                    placeholder="e.g. 640.00"
                    autoFocus
                  />
                </div>

                {/* Quick Add Presets */}
                <div style={{ marginTop: '10px' }}>
                  <span style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '6px' }}>
                    Quick Price Adjustments:
                  </span>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {[-50, -20, 0, 20, 50, 100].map((adj) => {
                      const computed = (parseFloat(String(targetProduct.selling_price)) + adj).toFixed(2);
                      return (
                        <button
                          key={adj}
                          type="button"
                          onClick={() => setPriceInput(computed)}
                          className="portal-btn portal-btn-sm"
                          style={{
                            fontSize: '11px',
                            padding: '3px 8px',
                            background: adj === 0 ? '#f1f5f9' : '#fff',
                          }}
                        >
                          {adj === 0 ? 'Universal' : adj > 0 ? `+₹${adj}` : `-₹${Math.abs(adj)}`} (₹{computed})
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Price Difference Indicator */}
                {inputDelta !== 0 && (
                  <div
                    style={{
                      marginTop: '16px',
                      padding: '10px',
                      borderRadius: '4px',
                      background: inputDelta > 0 ? '#f0fdf4' : '#fffbeb',
                      border: `1px solid ${inputDelta > 0 ? '#bbf7d0' : '#fef3c7'}`,
                      fontSize: '13px',
                      color: inputDelta > 0 ? '#15803d' : '#b45309',
                    }}
                  >
                    <strong>Price Delta: </strong>
                    {inputDelta > 0 ? `+₹${inputDelta.toFixed(2)}` : `-₹${Math.abs(inputDelta).toFixed(2)}`} compared to universal
                    ({Math.abs((inputDelta / parseFloat(String(targetProduct.selling_price))) * 100).toFixed(1)}% {inputDelta > 0 ? 'increase' : 'decrease'}).
                  </div>
                )}
              </div>

              <div className="portal-modal-footer">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="portal-btn portal-btn-secondary"
                  disabled={setPriceMutation.isPending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="portal-btn portal-btn-primary"
                  disabled={setPriceMutation.isPending}
                >
                  {setPriceMutation.isPending ? 'Saving…' : 'Save City Price'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
