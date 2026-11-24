import { useState, useMemo, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { portalApi, allPages, type StockBalance, type PortalVariant, type PortalProduct } from '../../api';
import { useAuth } from '../../auth';
import { Search, X, Package, ChevronDown, ChevronUp } from '../ui/icons';

interface VariantStockItem {
  variantId: string;
  sku: string;
  size: string;
  stockQuantity: number;
  hasBalanceRow: boolean;
  isLowStock: boolean;
}

interface ProductStockGroup {
  productId: string;
  productName: string;
  productImage?: string;
  schoolId?: string | null;
  schoolName?: string | null;
  categoryName?: string;
  gender?: string;
  classRange?: string;
  totalStock: number;
  totalVariantsCount: number;
  stockedVariantsCount: number;
  uninitializedVariantsCount: number;
  variants: VariantStockItem[];
}

export function CityAvailabilityView() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Selected City (Admins are locked to their own city, Boss can choose)
  const canManageIndia = user?.role === 'BOSS';
  const isCityAdmin = user?.role === 'ADMIN' && Boolean(user?.city);
  const [selectedCityId, setSelectedCityId] = useState<string>('');
  const [receiptProduct, setReceiptProduct] = useState<ProductStockGroup | null>(null);
  const [receiptSizes, setReceiptSizes] = useState<string[]>([]);
  const [receiptQuantity, setReceiptQuantity] = useState('');
  const [search, setSearch] = useState('');
  const [schoolFilter, setSchoolFilter] = useState('');

  // Expand / collapse tracking for product rows
  const [expandedProductIds, setExpandedProductIds] = useState<Set<string>>(new Set());

  // Restock / Adjust Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [targetVariant, setTargetVariant] = useState<{
    id: string;
    sku: string;
    productName: string;
    size: string;
    currentQty: number;
    hasBalanceRow: boolean;
  } | null>(null);

  const [quantityInput, setQuantityInput] = useState<number | ''>('');
  const [movementReason, setMovementReason] = useState<string>('RESTOCK');
  const [movementError, setMovementError] = useState('');
  const [movementSuccess, setMovementSuccess] = useState('');

  // Fetch Cities
  const { data: citiesData } = useQuery({
    queryKey: ['portal-cities'],
    queryFn: () => portalApi.cities(),
  });
  const cities = citiesData?.results ?? [];

  // Effective city ID (default to first city if none selected for Boss)
  const activeCityId = isCityAdmin ? user?.city || '' : selectedCityId || (canManageIndia ? 'india' : cities[0]?.id || '');
  const isIndia = activeCityId === 'india';
  const inventoryLocation = isIndia ? 'India' : cities.find((city) => city.id === activeCityId)?.name || 'Selected city';
  const stockLocation = isIndia ? { scope: 'india' as const } : { city: activeCityId };

  // Fetch Schools for filter
  const { data: schoolsData } = useQuery({
    queryKey: ['portal-schools-all'],
    queryFn: () => portalApi.schools({ page_size: '100' }),
  });
  const schools = schoolsData?.results ?? [];

  // Fetch Stock Balances for active city
  const balanceParams = useMemo(() => {
    const p: Record<string, string> = { page_size: '100' };
    if (isIndia) p.scope = 'india';
    else if (activeCityId) p.city = activeCityId;
    if (schoolFilter) p.school = schoolFilter;
    return p;
  }, [activeCityId, isIndia, schoolFilter]);

  const { data: balancesData, isLoading: balancesLoading, error: balancesError } = useQuery({
    queryKey: ['portal-stock-balances', balanceParams],
    queryFn: () => allPages(portalApi.stockBalances, balanceParams),
    enabled: Boolean(activeCityId),
  });
  const balances = balancesData?.results ?? [];

  // Fetch Products & Variants to find items without stock balance rows in this city
  const productParams = useMemo(() => {
    const p: Record<string, string> = { page_size: '100' };
    if (schoolFilter) p.school = schoolFilter;
    return p;
  }, [schoolFilter]);

  const { data: productsData, isLoading: productsLoading } = useQuery({
    queryKey: ['portal-products-stock', productParams],
    queryFn: () => allPages(portalApi.products, productParams),
  });
  const products = productsData?.results ?? [];

  // Map of variantId -> StockBalance
  const balanceByVariant = useMemo(() => {
    const map = new Map<string, StockBalance>();
    for (const b of balances) {
      map.set(b.variant, b);
    }
    return map;
  }, [balances]);

  // Group products and their variants into clean product-level cards/rows
  const productGroups: ProductStockGroup[] = useMemo(() => {
    const groups: ProductStockGroup[] = [];
    const seenProductIds = new Set<string>();

    for (const p of products) {
      // A school's own items are stocked only in that school's city; the server refuses
      // stock for them anywhere else, so do not offer them under another city.
      if (p.city && activeCityId && p.city !== activeCityId) continue;
      seenProductIds.add(p.id);
      const variantItems: VariantStockItem[] = [];
      let totalStock = 0;
      let stockedCount = 0;
      let uninitCount = 0;

      if (p.variants && p.variants.length > 0) {
        for (const v of p.variants) {
          const bal = balanceByVariant.get(v.id);
          const qty = bal ? bal.stock_quantity : 0;
          const hasRow = Boolean(bal);
          const isLow = bal ? bal.is_low_stock : true;

          if (qty > 0) stockedCount++;
          if (!hasRow) uninitCount++;
          totalStock += qty;

          variantItems.push({
            variantId: v.id,
            sku: v.sku,
            size: v.size,
            stockQuantity: qty,
            hasBalanceRow: hasRow,
            isLowStock: isLow,
          });
        }
      }

      const classRange =
        p.class_from && p.class_to
          ? `Class ${p.class_from}–${p.class_to}`
          : p.class_from
          ? `Class ${p.class_from}+`
          : p.grades && p.grades.length > 0
          ? `Grades ${p.grades.join(', ')}`
          : undefined;

      groups.push({
        productId: p.id,
        productName: p.name,
        productImage: p.images && p.images.length > 0 ? p.images[0] : undefined,
        schoolId: p.school,
        schoolName: p.school_name,
        categoryName: p.category_name,
        gender: p.gender,
        classRange,
        totalStock,
        totalVariantsCount: variantItems.length,
        stockedVariantsCount: stockedCount,
        uninitializedVariantsCount: uninitCount,
        variants: variantItems,
      });
    }

    // Filter by search query (matches product name, category, school, variant SKU, or size)
    if (!search.trim()) return groups;
    const q = search.trim().toLowerCase();
    return groups.filter((g) => {
      const matchProduct =
        g.productName.toLowerCase().includes(q) ||
        (g.schoolName && g.schoolName.toLowerCase().includes(q)) ||
        (g.categoryName && g.categoryName.toLowerCase().includes(q));

      const matchVariant = g.variants.some(
        (v) => v.sku.toLowerCase().includes(q) || v.size.toLowerCase().includes(q)
      );

      return matchProduct || matchVariant;
    });
  }, [products, balanceByVariant, search, activeCityId]);

  // Toggle expand for single product
  const toggleProductExpand = (id: string) => {
    setExpandedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Expand / collapse all
  const expandAll = () => {
    setExpandedProductIds(new Set(productGroups.map((g) => g.productId)));
  };
  const collapseAll = () => {
    setExpandedProductIds(new Set());
  };

  // Restock Modal openers
  const openRestockModal = (
    productName: string,
    item: VariantStockItem
  ) => {
    setTargetVariant({
      id: item.variantId,
      sku: item.sku,
      productName,
      size: item.size,
      currentQty: item.stockQuantity,
      hasBalanceRow: item.hasBalanceRow,
    });
    setQuantityInput('');
    setMovementReason(item.hasBalanceRow ? 'RESTOCK' : 'INITIAL_STOCK');
    setMovementError('');
    setMovementSuccess('');
    setModalOpen(true);
  };

  // Zero out a single variant
  const markVariantOutOfStock = useMutation({
    mutationFn: async (item: VariantStockItem) => {
      if (item.stockQuantity <= 0) return;
      return portalApi.addStockMovement({
        variant: item.variantId,
        ...stockLocation,
        quantity_change: -item.stockQuantity,
        reason: 'ADJUSTMENT',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-stock-balances'] });
      queryClient.invalidateQueries({ queryKey: ['store', 'products'] });
    },
  });

  // Zero out all variants of a product in this city
  const markProductOutOfStock = useMutation({
    mutationFn: async (group: ProductStockGroup) => {
      const itemsToZero = group.variants.filter((v) => v.stockQuantity > 0);
      for (const item of itemsToZero) {
        await portalApi.addStockMovement({
          variant: item.variantId,
          ...stockLocation,
          quantity_change: -item.stockQuantity,
          reason: 'ADJUSTMENT',
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-stock-balances'] });
      queryClient.invalidateQueries({ queryKey: ['store', 'products'] });
    },
  });

  // Apply movement form
  const movementMutation = useMutation({
    mutationFn: async () => {
      if (!targetVariant) return;
      if (quantityInput === '' || !Number.isInteger(quantityInput) || quantityInput === 0) {
        throw new Error('Enter a nonzero whole number of units for this size.');
      }
      if (movementReason === 'INITIAL_STOCK' && quantityInput < 1) {
        throw new Error('Initial stock must be at least one unit.');
      }
      return portalApi.addStockMovement({
        variant: targetVariant.id,
        ...stockLocation,
        quantity_change: quantityInput,
        reason: movementReason,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-stock-balances'] });
      queryClient.invalidateQueries({ queryKey: ['store', 'products'] });
      setMovementSuccess('Stock updated successfully.');
      setTimeout(() => {
        setModalOpen(false);
        setMovementSuccess('');
      }, 500);
    },
    onError: (err: any) => {
      setMovementError(err instanceof Error ? err.message : 'Stock movement failed.');
    },
  });

  const receiptMutation = useMutation({
    mutationFn: () => portalApi.receiveIndiaStock(receiptSizes, Number(receiptQuantity)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-stock-balances'] });
      queryClient.invalidateQueries({ queryKey: ['store', 'products'] });
      setReceiptProduct(null);
    },
  });

  const openReceipt = (product: ProductStockGroup) => {
    receiptMutation.reset();
    setReceiptProduct(product);
    setReceiptSizes([]);
    setReceiptQuantity('');
  };

  // Overall city stats
  const totalCityUnits = useMemo(() => {
    return productGroups.reduce((acc, g) => acc + g.totalStock, 0);
  }, [productGroups]);

  const inStockProductsCount = useMemo(() => {
    return productGroups.filter((g) => g.totalStock > 0).length;
  }, [productGroups]);

  return (
    <div>
      <div className="portal-page-header">
        <div>
          <h1 className="portal-page-title">Stock & Availability</h1>
          <p className="portal-page-sub">
            Manage inventory by product and size. India stock is shared across the parent store.
          </p>
        </div>
      </div>

      <div className="portal-card">
        {/* Filters and Controls */}
        <div className="portal-filters-row">
          {/* City Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700 }}>Inventory:</span>
            {isCityAdmin ? (
              <span
                style={{
                  fontSize: '13px',
                  fontWeight: 700,
                  background: 'var(--paper)',
                  padding: '6px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--line)',
                }}
              >
                {user?.city_name || 'My City'}
              </span>
            ) : (
              <select
                className="portal-select"
                value={activeCityId}
                onChange={(e) => setSelectedCityId(e.target.value)}
              >
                {canManageIndia && <option value="india">India (shared stock)</option>}
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="portal-search-box">
            <Search width={16} height={16} className="portal-search-icon" />
            <input
              type="text"
              placeholder="Search by product, SKU, size, or school..."
              className="portal-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select
            className="portal-select"
            value={schoolFilter}
            onChange={(e) => setSchoolFilter(e.target.value)}
          >
            <option value="">All Schools</option>
            {schools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.code})
              </option>
            ))}
          </select>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="portal-btn portal-btn-secondary portal-btn-sm"
              onClick={expandAll}
              title="Expand all size drawers"
            >
              Expand All
            </button>
            <button
              type="button"
              className="portal-btn portal-btn-secondary portal-btn-sm"
              onClick={collapseAll}
              title="Collapse all size drawers"
            >
              Collapse All
            </button>
          </div>
        </div>

        {/* Quick Metrics Bar */}
        <div
          style={{
            display: 'flex',
            gap: '16px',
            padding: '10px 14px',
            background: 'var(--paper)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--line)',
            fontSize: '13px',
            marginBottom: '16px',
            flexWrap: 'wrap',
          }}
        >
          <div>
            Inventory: <strong>{inventoryLocation}</strong>
          </div>
          <div>·</div>
          <div>
            Catalog Products: <strong>{productGroups.length}</strong>
          </div>
          <div>·</div>
          <div>
            Total Stock On-Hand: <strong>{totalCityUnits.toLocaleString()} units</strong>
          </div>
          <div>·</div>
          <div>
            Products with stock: <strong>{inStockProductsCount} products</strong>
          </div>
        </div>

        {/* Product Grouped Table */}
        {balancesLoading || productsLoading ? (
          <div>
            <div className="portal-skeleton-row" />
            <div className="portal-skeleton-row" />
            <div className="portal-skeleton-row" />
          </div>
        ) : balancesError ? (
          <div className="portal-alert-error">
            Failed to load stock: {balancesError instanceof Error ? balancesError.message : 'Unknown error'}
          </div>
        ) : productGroups.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ink-soft)' }}>
            <Package width={36} height={36} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
            <div style={{ fontWeight: 600, fontSize: '15px' }}>No products found</div>
            <div style={{ fontSize: '13px', marginTop: '4px' }}>
              Select a school or adjust your search filter.
            </div>
          </div>
        ) : (
          <div className="portal-table-container">
            <table className="portal-table">
              <thead>
                <tr>
                  <th style={{ width: '40px' }} />
                  <th>Product Details</th>
                  <th>Configured Sizes</th>
                  <th>Total stock</th>
                  <th>Availability Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {productGroups.map((group) => {
                  const isExpanded = expandedProductIds.has(group.productId) || Boolean(search.trim());

                  return (
                    <Fragment key={group.productId}>
                      <tr
                        style={{
                          backgroundColor: isExpanded ? 'rgba(47, 93, 80, 0.04)' : undefined,
                          cursor: 'pointer',
                        }}
                        onClick={() => toggleProductExpand(group.productId)}
                      >
                        {/* Toggle Icon */}
                        <td style={{ textAlign: 'center', padding: '12px 6px' }}>
                          <button
                            type="button"
                            className="portal-btn portal-btn-secondary portal-btn-sm"
                            style={{ padding: '4px', border: 'none', background: 'transparent' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleProductExpand(group.productId);
                            }}
                            aria-label={isExpanded ? 'Collapse' : 'Expand'}
                          >
                            {isExpanded ? (
                              <ChevronUp width={16} height={16} />
                            ) : (
                              <ChevronDown width={16} height={16} />
                            )}
                          </button>
                        </td>

                        {/* Product Info with Thumbnail */}
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            {group.productImage ? (
                              <img
                                src={group.productImage}
                                alt={group.productName}
                                style={{
                                  width: '42px',
                                  height: '42px',
                                  objectFit: 'cover',
                                  borderRadius: 'var(--radius-sm)',
                                  border: '1px solid var(--line)',
                                  flexShrink: 0,
                                }}
                              />
                            ) : (
                              <div
                                style={{
                                  width: '42px',
                                  height: '42px',
                                  background: 'var(--paper)',
                                  borderRadius: 'var(--radius-sm)',
                                  border: '1px solid var(--line)',
                                  display: 'grid',
                                  placeItems: 'center',
                                  flexShrink: 0,
                                  color: 'var(--ink-faint)',
                                }}
                              >
                                <Package width={20} height={20} />
                              </div>
                            )}

                            <div>
                              <div style={{ fontWeight: 700, fontSize: '14px' }}>
                                {group.productName}
                              </div>
                              <div style={{ fontSize: '12px', color: 'var(--ink-soft)', marginTop: '2px' }}>
                                {group.schoolName && (
                                  <span
                                    style={{
                                      background: 'var(--paper-sunk)',
                                      padding: '1px 6px',
                                      borderRadius: '3px',
                                      marginRight: '6px',
                                      fontWeight: 600,
                                    }}
                                  >
                                    {group.schoolName}
                                  </span>
                                )}
                                {group.categoryName && <span>{group.categoryName} · </span>}
                                {group.gender && <span>{group.gender} · </span>}
                                {group.classRange && <span>{group.classRange}</span>}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Sizes Summary */}
                        <td>
                          <div style={{ fontSize: '12px', fontWeight: 600 }}>
                            {group.totalVariantsCount} {group.totalVariantsCount === 1 ? 'size' : 'sizes'}
                          </div>
                          <div
                            style={{
                              fontSize: '11px',
                              color: 'var(--ink-soft)',
                              maxWidth: '220px',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              marginTop: '2px',
                            }}
                            title={group.variants.map((v) => v.size).join(', ')}
                          >
                            {group.variants.map((v) => v.size).join(', ') || 'No sizes configured'}
                          </div>
                        </td>

                        {/* City Stock (Total) */}
                        <td>
                          <span style={{ fontSize: '15px', fontWeight: 800 }}>
                            {group.totalStock}
                          </span>{' '}
                          <span style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>units</span>
                        </td>

                        {/* Availability Status Badge */}
                        <td>
                          {group.totalStock > 0 && group.stockedVariantsCount === group.totalVariantsCount ? (
                            <span className="portal-badge-instock">
                              All In Stock ({group.totalStock} units)
                            </span>
                          ) : group.totalStock > 0 ? (
                            <span className="portal-badge-warning">
                              Partial ({group.stockedVariantsCount}/{group.totalVariantsCount} sizes)
                            </span>
                          ) : group.uninitializedVariantsCount > 0 ? (
                            <span className="portal-badge-inactive">
                              Not Stocked ({group.uninitializedVariantsCount} uninitialized)
                            </span>
                          ) : (
                            <span className="portal-badge-outofstock">Out of Stock (0 units)</span>
                          )}
                        </td>

                        {/* Actions */}
                        <td style={{ textAlign: 'right' }}>
                          <div
                            style={{ display: 'inline-flex', gap: '6px' }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="portal-btn portal-btn-secondary portal-btn-sm"
                              onClick={() => toggleProductExpand(group.productId)}
                            >
                              {isExpanded ? 'Hide Sizes' : `Manage Sizes (${group.totalVariantsCount})`}
                            </button>

                            {isIndia && (
                              <button type="button" className="portal-btn portal-btn-primary portal-btn-sm" onClick={() => openReceipt(group)}>
                                Stock selected sizes
                              </button>
                            )}

                            {group.totalStock > 0 && (
                              <button
                                type="button"
                                className="portal-btn portal-btn-danger portal-btn-sm"
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Are you sure you want to mark all sizes of "${group.productName}" out of stock in ${inventoryLocation}?`
                                    )
                                  ) {
                                    markProductOutOfStock.mutate(group);
                                  }
                                }}
                                disabled={markProductOutOfStock.isPending}
                                title="Zero out all sizes for this product in the selected inventory"
                              >
                                Mark 0
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Expandable Sub-Table for Sizes */}
                      {isExpanded && (
                        <tr style={{ backgroundColor: 'rgba(47, 93, 80, 0.02)' }}>
                          <td colSpan={6} style={{ padding: '0 14px 14px 44px' }}>
                            <div className="portal-subtable-container">
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  marginBottom: '8px',
                                }}
                              >
                                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--ink)' }}>
                                  Individual Size Inventory for {inventoryLocation}
                                </span>
                                <span style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>
                                  Click Restock or Adjust to record a stock movement
                                </span>
                              </div>

                              <table className="portal-subtable">
                                <thead>
                                  <tr>
                                    <th>Size</th>
                                    <th>SKU</th>
                                    <th>Units</th>
                                    <th>Status</th>
                                    <th style={{ textAlign: 'right' }}>Actions</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {group.variants.map((v) => (
                                    <tr key={v.variantId}>
                                      <td>
                                        <strong style={{ fontSize: '13px' }}>Size {v.size}</strong>
                                      </td>
                                      <td>
                                        <code style={{ fontSize: '12px' }}>{v.sku}</code>
                                      </td>
                                      <td>
                                        <strong style={{ fontSize: '13px' }}>{v.stockQuantity}</strong>{' '}
                                        <span style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>units</span>
                                      </td>
                                      <td>
                                        {!v.hasBalanceRow ? (
                                          <span className="portal-badge-inactive">Not Stocked</span>
                                        ) : v.stockQuantity > 0 ? (
                                          <span className="portal-badge-instock">
                                            Available ({v.stockQuantity})
                                          </span>
                                        ) : (
                                          <span className="portal-badge-outofstock">0 units</span>
                                        )}
                                      </td>
                                      <td style={{ textAlign: 'right' }}>
                                        <div style={{ display: 'inline-flex', gap: '6px' }}>
                                          <button
                                            type="button"
                                            className="portal-btn portal-btn-primary portal-btn-sm"
                                            onClick={() => openRestockModal(group.productName, v)}
                                          >
                                            {!v.hasBalanceRow ? 'Initialize' : 'Restock / Adjust'}
                                          </button>

                                          {v.hasBalanceRow && v.stockQuantity > 0 && (
                                            <button
                                              type="button"
                                              className="portal-btn portal-btn-danger portal-btn-sm"
                                              onClick={() => markVariantOutOfStock.mutate(v)}
                                              disabled={markVariantOutOfStock.isPending}
                                              title="Zero out this size"
                                            >
                                              Zero Out
                                            </button>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Restock / Adjust Stock Modal */}
      {receiptProduct && (
        <div className="portal-modal-backdrop">
          <div className="portal-modal" role="dialog" aria-modal="true" aria-labelledby="india-receipt-title">
            <div className="portal-modal-header">
              <h2 id="india-receipt-title" className="portal-modal-title">Stock selected sizes</h2>
            </div>
            <form onSubmit={(event) => {
              event.preventDefault();
              if (receiptSizes.length && Number.isInteger(Number(receiptQuantity)) && Number(receiptQuantity) > 0) {
                receiptMutation.mutate();
              }
            }}>
              <div className="portal-modal-body">
                <p>{receiptProduct.productName} · India</p>
                <fieldset disabled={receiptMutation.isPending}>
                  <legend>Choose sizes</legend>
                  {receiptProduct.variants.map((variant) => (
                    <label key={variant.variantId} style={{ display: 'inline-flex', gap: 6, margin: '6px 14px 6px 0' }}>
                      <input type="checkbox" checked={receiptSizes.includes(variant.variantId)} onChange={(event) => {
                        const checked = event.target.checked;
                        setReceiptSizes((sizes) => checked
                          ? [...sizes, variant.variantId]
                          : sizes.filter((size) => size !== variant.variantId));
                      }} />
                      {variant.size} ({variant.stockQuantity} on hand)
                    </label>
                  ))}
                </fieldset>
                <div className="portal-form-group">
                  <label htmlFor="receipt-quantity" className="portal-form-label">Units to add per selected size</label>
                  <input id="receipt-quantity" className="portal-form-input" type="number" min={1} max={2147483647} step={1}
                    required value={receiptQuantity} disabled={receiptMutation.isPending}
                    onChange={(event) => setReceiptQuantity(event.target.value)} />
                  <p>{receiptSizes.length} selected · {(receiptSizes.length * Number(receiptQuantity)).toLocaleString()} total units to add</p>
                </div>
                {receiptMutation.error && <p className="portal-alert-error" role="alert">{receiptMutation.error.message}</p>}
              </div>
              <div className="portal-modal-footer">
                <button type="button" className="portal-btn portal-btn-secondary" disabled={receiptMutation.isPending} onClick={() => setReceiptProduct(null)}>Cancel</button>
                <button type="submit" className="portal-btn portal-btn-primary" disabled={receiptMutation.isPending || !receiptSizes.length || !receiptQuantity}>
                  {receiptMutation.isPending ? 'Saving…' : 'Add stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalOpen && targetVariant && (
        <div className="portal-modal-backdrop">
          <div className="portal-modal" style={{ maxWidth: '480px' }}>
            <div className="portal-modal-header">
              <div>
                <h2 className="portal-modal-title">
                  {targetVariant.hasBalanceRow ? 'Record Stock Movement' : 'Initialize Stock'}
                </h2>
                <div style={{ fontSize: '12px', color: 'var(--ink-soft)' }}>
                  {targetVariant.productName} (Size: {targetVariant.size})
                </div>
              </div>
              <button
                type="button"
                className="portal-btn portal-btn-secondary portal-btn-sm"
                onClick={() => setModalOpen(false)}
                aria-label="Close"
              >
                <X width={16} height={16} />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                movementMutation.mutate();
              }}
            >
              <div className="portal-modal-body">
                {movementError && <div className="portal-alert-error">{movementError}</div>}
                {movementSuccess && <div className="portal-alert-success">{movementSuccess}</div>}

                <div
                  style={{
                    padding: '10px 12px',
                    background: 'var(--paper)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--line)',
                    fontSize: '13px',
                  }}
                >
                  <div>Inventory: <strong>{inventoryLocation}</strong></div>
                  <div>SKU: <code>{targetVariant.sku}</code></div>
                  <div>Current Balance: <strong>{targetVariant.currentQty} units</strong></div>
                </div>

                <div className="portal-form-group">
                  <label className="portal-form-label">Movement Reason</label>
                  <select
                    className="portal-form-input"
                    value={movementReason}
                    onChange={(e) => setMovementReason(e.target.value)}
                  >
                    {!targetVariant.hasBalanceRow && (
                      <option value="INITIAL_STOCK">Initial Stock Entry</option>
                    )}
                    <option value="RESTOCK">Restock (Shipment Received)</option>
                    <option value="ADJUSTMENT">Manual Adjustment (Inventory Count)</option>
                    <option value="DAMAGE">Damaged / Write-off</option>
                    <option value="RETURN">Customer Return</option>
                  </select>
                </div>

                <div className="portal-form-group">
                  <label className="portal-form-label">
                    {movementReason === 'INITIAL_STOCK' ? 'Initial quantity for this size' : 'Quantity change (positive to add, negative to subtract)'}
                  </label>
                  <input
                    type="number"
                    required
                    className="portal-form-input"
                    value={quantityInput}
                    onChange={(e) =>
                      setQuantityInput(e.target.value === '' ? '' : Number(e.target.value))
                    }
                    min={movementReason === 'INITIAL_STOCK' ? 1 : undefined}
                    step={1}
                    placeholder="Enter units"
                  />
                  <div style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>
                    New calculated balance will be:{' '}
                    <strong>
                      {Math.max(
                        0,
                        targetVariant.currentQty +
                          (quantityInput === '' ? 0 : Number(quantityInput))
                      )}{' '}
                      units
                    </strong>
                  </div>
                </div>
              </div>

              <div className="portal-modal-footer">
                <button
                  type="button"
                  className="portal-btn portal-btn-secondary"
                  onClick={() => setModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="portal-btn portal-btn-primary"
                  disabled={movementMutation.isPending || quantityInput === '' || quantityInput === 0}
                >
                  {movementMutation.isPending ? 'Recording Movement...' : 'Apply Movement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
