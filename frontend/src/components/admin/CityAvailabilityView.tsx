import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { portalApi, type StockBalance, type PortalVariant, type PortalProduct } from '../../api';
import { useAuth } from '../../auth';
import { Search, Plus, X, Package, RefreshCw } from '../ui/icons';

export function CityAvailabilityView() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Selected City (Admins are locked to their own city, Boss can choose)
  const isCityAdmin = user?.role === 'ADMIN' && Boolean(user?.city);
  const [selectedCityId, setSelectedCityId] = useState<string>(user?.city || '');
  const [search, setSearch] = useState('');
  const [schoolFilter, setSchoolFilter] = useState('');

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

  const [quantityInput, setQuantityInput] = useState<number | ''>(50);
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
  const activeCityId = selectedCityId || (isCityAdmin ? user?.city || '' : cities[0]?.id || '');

  // Fetch Schools for filter
  const { data: schoolsData } = useQuery({
    queryKey: ['portal-schools-all'],
    queryFn: () => portalApi.schools({ page_size: '100' }),
  });
  const schools = schoolsData?.results ?? [];

  // Fetch Stock Balances for active city
  const balanceParams = useMemo(() => {
    const p: Record<string, string> = { page_size: '50' };
    if (activeCityId) p.city = activeCityId;
    if (schoolFilter) p.school = schoolFilter;
    return p;
  }, [activeCityId, schoolFilter]);

  const { data: balancesData, isLoading: balancesLoading, error: balancesError } = useQuery({
    queryKey: ['portal-stock-balances', balanceParams],
    queryFn: () => portalApi.stockBalances(balanceParams),
    enabled: Boolean(activeCityId),
  });
  const balances = balancesData?.results ?? [];

  // Fetch Products & Variants to find items without stock balance rows in this city
  const productParams = useMemo(() => {
    const p: Record<string, string> = { page_size: '50' };
    if (schoolFilter) p.school = schoolFilter;
    return p;
  }, [schoolFilter]);

  const { data: productsData, isLoading: productsLoading } = useQuery({
    queryKey: ['portal-products-stock', productParams],
    queryFn: () => portalApi.products(productParams),
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

  // Combine balances with variants so admin can initialize unstocked items (e.g. KV school items)
  interface CombinedStockRow {
    variantId: string;
    sku: string;
    productName: string;
    productCategory: string;
    size: string;
    stockQuantity: number;
    hasBalanceRow: boolean;
    isLowStock: boolean;
  }

  const allRows: CombinedStockRow[] = useMemo(() => {
    const rows: CombinedStockRow[] = [];
    const seenVariantIds = new Set<string>();

    // First include all items that have explicit stock balance rows
    for (const b of balances) {
      seenVariantIds.add(b.variant);
      rows.push({
        variantId: b.variant,
        sku: b.variant_sku,
        productName: b.product_name,
        productCategory: b.product_category || '',
        size: b.variant_size || '',
        stockQuantity: b.stock_quantity,
        hasBalanceRow: true,
        isLowStock: b.is_low_stock,
      });
    }

    // Next, check products & their variants for any items missing a balance row in this city
    for (const p of products) {
      if (!p.variants) continue;
      for (const v of p.variants) {
        if (!seenVariantIds.has(v.id)) {
          seenVariantIds.add(v.id);
          rows.push({
            variantId: v.id,
            sku: v.sku,
            productName: p.name,
            productCategory: p.category_name || '',
            size: v.size,
            stockQuantity: 0,
            hasBalanceRow: false,
            isLowStock: true,
          });
        }
      }
    }

    // Filter by search
    if (!search.trim()) return rows;
    const query = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        r.sku.toLowerCase().includes(query) ||
        r.productName.toLowerCase().includes(query) ||
        r.size.toLowerCase().includes(query)
    );
  }, [balances, products, search]);

  // Actions
  const openRestockModal = (row: CombinedStockRow) => {
    setTargetVariant({
      id: row.variantId,
      sku: row.sku,
      productName: row.productName,
      size: row.size,
      currentQty: row.stockQuantity,
      hasBalanceRow: row.hasBalanceRow,
    });
    setQuantityInput(50);
    setMovementReason(row.hasBalanceRow ? 'RESTOCK' : 'INITIAL_STOCK');
    setMovementError('');
    setMovementSuccess('');
    setModalOpen(true);
  };

  const markOutOfStockMutation = useMutation({
    mutationFn: async (row: CombinedStockRow) => {
      if (row.stockQuantity <= 0) return;
      return portalApi.addStockMovement({
        variant: row.variantId,
        city: activeCityId,
        quantity_change: -row.stockQuantity,
        reason: 'ADJUSTMENT',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-stock-balances'] });
    },
  });

  const movementMutation = useMutation({
    mutationFn: async () => {
      if (!targetVariant) return;
      if (quantityInput === '' || Number(quantityInput) === 0) {
        throw new Error('Quantity change must not be zero.');
      }
      return portalApi.addStockMovement({
        variant: targetVariant.id,
        city: activeCityId,
        quantity_change: Number(quantityInput),
        reason: movementReason,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-stock-balances'] });
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

  const selectedCityObj = cities.find((c) => c.id === activeCityId);

  return (
    <div>
      <div className="portal-page-header">
        <div>
          <h1 className="portal-page-title">City Stock & Availability</h1>
          <p className="portal-page-sub">
            Monitor on-hand inventory per city, manage restocks, and mark items out of stock.
          </p>
        </div>
      </div>

      <div className="portal-card">
        {/* Filters */}
        <div className="portal-filters-row">
          {/* City Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700 }}>City:</span>
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
              placeholder="Search by SKU, product name, or size..."
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
        </div>

        {/* Content Table */}
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
        ) : allRows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ink-soft)' }}>
            <Package width={36} height={36} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
            <div style={{ fontWeight: 600, fontSize: '15px' }}>No inventory rows found</div>
            <div style={{ fontSize: '13px', marginTop: '4px' }}>
              Select a school or adjust your search filter.
            </div>
          </div>
        ) : (
          <div className="portal-table-container">
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Product & Size</th>
                  <th>SKU</th>
                  <th>City</th>
                  <th>Current Stock</th>
                  <th>Availability Status</th>
                  <th style={{ textAlign: 'right' }}>Stock Actions</th>
                </tr>
              </thead>
              <tbody>
                {allRows.map((row) => (
                  <tr key={row.variantId}>
                    <td>
                      <div style={{ fontWeight: 700 }}>{row.productName}</div>
                      <div style={{ fontSize: '12px', color: 'var(--ink-soft)' }}>
                        Size: <strong>{row.size}</strong> {row.productCategory ? `· ${row.productCategory}` : ''}
                      </div>
                    </td>
                    <td>
                      <code style={{ fontSize: '12px' }}>{row.sku}</code>
                    </td>
                    <td>{selectedCityObj?.name || 'City'}</td>
                    <td>
                      <span style={{ fontSize: '15px', fontWeight: 800 }}>
                        {row.stockQuantity}
                      </span>{' '}
                      <span style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>units</span>
                    </td>
                    <td>
                      {!row.hasBalanceRow ? (
                        <span className="portal-badge-inactive">Not Stocked in City</span>
                      ) : row.stockQuantity > 0 ? (
                        <span className="portal-badge-instock">Available ({row.stockQuantity})</span>
                      ) : (
                        <span className="portal-badge-outofstock">Out of Stock</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '6px' }}>
                        <button
                          type="button"
                          className="portal-btn portal-btn-primary portal-btn-sm"
                          onClick={() => openRestockModal(row)}
                        >
                          {!row.hasBalanceRow ? 'Initialize Stock' : 'Restock / Adjust'}
                        </button>

                        {row.hasBalanceRow && row.stockQuantity > 0 && (
                          <button
                            type="button"
                            className="portal-btn portal-btn-danger portal-btn-sm"
                            onClick={() => markOutOfStockMutation.mutate(row)}
                            disabled={markOutOfStockMutation.isPending}
                            title="Zero out inventory for this city"
                          >
                            Mark Out of Stock
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Restock / Adjust Stock Modal */}
      {modalOpen && targetVariant && (
        <div className="portal-modal-backdrop">
          <div className="portal-modal" style={{ maxWidth: '480px' }}>
            <div className="portal-modal-header">
              <div>
                <h2 className="portal-modal-title">
                  {targetVariant.hasBalanceRow ? 'Record Stock Movement' : 'Initialize City Stock'}
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
                  <div>Target City: <strong>{selectedCityObj?.name || 'City'}</strong></div>
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
                    Quantity Delta * (Positive to add, negative to subtract)
                  </label>
                  <input
                    type="number"
                    required
                    className="portal-form-input"
                    value={quantityInput}
                    onChange={(e) =>
                      setQuantityInput(e.target.value === '' ? '' : Number(e.target.value))
                    }
                    placeholder="e.g. 50 or -10"
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
