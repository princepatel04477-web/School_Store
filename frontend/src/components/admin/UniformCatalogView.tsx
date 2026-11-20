import { useState, useMemo, type FormEvent, type ChangeEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { portalApi, type PortalProduct, type PortalVariant, type CitySchool } from '../../api';
import { Search, Plus, X, Camera, RefreshCw } from '../ui/icons';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toUpperCase();
}

export function UniformCatalogView() {
  const queryClient = useQueryClient();

  // Filters
  const [search, setSearch] = useState('');
  const [schoolFilter, setSchoolFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [genderFilter, setGenderFilter] = useState('');
  const [classFilter, setClassFilter] = useState('');

  // Modals
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [sizesModalOpen, setSizesModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<PortalProduct | null>(null);
  const [managingSizesProduct, setManagingSizesProduct] = useState<PortalProduct | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [productType, setProductType] = useState<string>('');
  const [gender, setGender] = useState<'boy' | 'girl' | 'unisex'>('unisex');
  const [classFrom, setClassFrom] = useState<number | ''>('');
  const [classTo, setClassTo] = useState<number | ''>('');
  const [costPrice, setCostPrice] = useState<string>('0.00');
  const [sellingPrice, setSellingPrice] = useState<string>('');
  const [active, setActive] = useState(true);

  // Photo Upload State
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(false);
  const [photoError, setPhotoError] = useState('');

  // Form errors
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');

  // Size Variant State
  const [newSizeName, setNewSizeName] = useState('');
  const [sizeError, setSizeError] = useState('');

  // Queries
  const { data: categoriesData } = useQuery({
    queryKey: ['portal-categories'],
    queryFn: () => portalApi.categories(),
  });
  const categories = categoriesData?.results ?? [];

  const { data: schoolsData } = useQuery({
    queryKey: ['portal-schools-all'],
    queryFn: () => portalApi.schools({ page_size: '100' }),
  });
  const schools = schoolsData?.results ?? [];

  const queryParams = useMemo(() => {
    const p: Record<string, string> = { page_size: '50' };
    if (search.trim()) p.search = search.trim();
    if (schoolFilter) p.school = schoolFilter;
    if (categoryFilter) p.category = categoryFilter;
    if (genderFilter) p.gender = genderFilter;
    if (classFilter) p.class = classFilter;
    return p;
  }, [search, schoolFilter, categoryFilter, genderFilter, classFilter]);

  const { data: productsData, isLoading, error } = useQuery({
    queryKey: ['portal-products', queryParams],
    queryFn: () => portalApi.products(queryParams),
  });
  const products = productsData?.results ?? [];

  const openCreateModal = () => {
    setEditingProduct(null);
    setName('');
    setDescription('');
    setCategoryId(categories[0]?.id || '');
    setSchoolId(schoolFilter || (schools[0]?.id || ''));
    setProductType('');
    setGender('unisex');
    setClassFrom('');
    setClassTo('');
    setCostPrice('0.00');
    setSellingPrice('');
    setActive(true);
    setPhotoFile(null);
    setPhotoPreview(null);
    setPhotoError('');
    setFormError('');
    setFormSuccess('');
    setItemModalOpen(true);
  };

  const openEditModal = (p: PortalProduct) => {
    setEditingProduct(p);
    setName(p.name);
    setDescription(p.description || '');
    setCategoryId(p.category);
    setSchoolId(p.school || '');
    setProductType(p.product_type || '');
    setGender(p.gender || 'unisex');
    setClassFrom(p.class_from ?? '');
    setClassTo(p.class_to ?? '');
    setCostPrice(p.cost_price != null ? String(p.cost_price) : '0.00');
    setSellingPrice(String(p.selling_price));
    setActive(p.active);
    setPhotoFile(null);
    setPhotoPreview(p.images && p.images.length > 0 ? p.images[0] : null);
    setPhotoError('');
    setFormError('');
    setFormSuccess('');
    setItemModalOpen(true);
  };

  const openSizesModal = (p: PortalProduct) => {
    setManagingSizesProduct(p);
    setNewSizeName('');
    setSizeError('');
    setSizesModalOpen(true);
  };

  const handlePhotoSelect = (e: ChangeEvent<HTMLInputElement>) => {
    setPhotoError('');
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 8 * 1024 * 1024) {
      setPhotoError('Image file exceeds the 8 MB limit.');
      return;
    }

    setPhotoFile(file);
    const objectUrl = URL.createObjectURL(file);
    setPhotoPreview(objectUrl);
  };

  const handlePhotoUploadNow = async () => {
    if (!editingProduct || !photoFile) return;
    setUploadProgress(true);
    setPhotoError('');
    try {
      const updated = await portalApi.uploadProductPhoto(editingProduct.id, photoFile);
      setEditingProduct(updated);
      setPhotoFile(null);
      if (updated.images && updated.images.length > 0) {
        setPhotoPreview(updated.images[0]);
      }
      queryClient.invalidateQueries({ queryKey: ['portal-products'] });
    } catch (err: any) {
      setPhotoError(err instanceof Error ? err.message : 'Photo upload failed.');
    } finally {
      setUploadProgress(false);
    }
  };

  const saveProductMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        name: name.trim(),
        description: description.trim(),
        category: categoryId,
        school: schoolId || null,
        product_type: productType || null,
        gender,
        class_from: classFrom === '' ? null : Number(classFrom),
        class_to: classTo === '' ? null : Number(classTo),
        cost_price: costPrice || '0.00',
        selling_price: sellingPrice,
        active,
      };

      if (editingProduct) {
        return portalApi.updateProduct(editingProduct.id, payload);
      } else {
        const created = await portalApi.createProduct(payload);
        if (photoFile) {
          try {
            await portalApi.uploadProductPhoto(created.id, photoFile);
          } catch (e) {
            console.error('Failed to upload photo for created product', e);
          }
        }
        return created;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-products'] });
      setFormSuccess(editingProduct ? 'Product updated successfully.' : 'Product created successfully.');
      setTimeout(() => {
        setItemModalOpen(false);
        setFormSuccess('');
      }, 600);
    },
    onError: (err: any) => {
      setFormError(err instanceof Error ? err.message : 'Failed to save uniform item.');
    },
  });

  const handleProductSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');
    saveProductMutation.mutate();
  };

  const addVariantMutation = useMutation({
    mutationFn: async () => {
      if (!managingSizesProduct || !newSizeName.trim()) {
        throw new Error('Size name is required.');
      }
      const sch = schools.find((s) => s.id === managingSizesProduct.school);
      const schoolCode = sch?.code || 'GEN';
      const itemSlug = slugify(managingSizesProduct.name).slice(0, 18);
      const sizeSlug = newSizeName.trim().toUpperCase();
      const sku = `${schoolCode}-${itemSlug}-${sizeSlug}`;

      return portalApi.createVariant({
        product: managingSizesProduct.id,
        size: newSizeName.trim(),
        sku,
        active: true,
      });
    },
    onSuccess: (newVar) => {
      setNewSizeName('');
      setSizeError('');
      if (managingSizesProduct) {
        setManagingSizesProduct({
          ...managingSizesProduct,
          variants: [...(managingSizesProduct.variants || []), newVar],
        });
      }
      queryClient.invalidateQueries({ queryKey: ['portal-products'] });
    },
    onError: (err: any) => {
      setSizeError(err instanceof Error ? err.message : 'Failed to add variant.');
    },
  });

  const toggleVariantMutation = useMutation({
    mutationFn: async ({ variantId, active }: { variantId: string; active: boolean }) => {
      return portalApi.updateVariant(variantId, { active });
    },
    onSuccess: (updatedVar) => {
      if (managingSizesProduct) {
        setManagingSizesProduct({
          ...managingSizesProduct,
          variants: (managingSizesProduct.variants || []).map((v) =>
            v.id === updatedVar.id ? updatedVar : v
          ),
        });
      }
      queryClient.invalidateQueries({ queryKey: ['portal-products'] });
    },
  });

  return (
    <div>
      <div className="portal-page-header">
        <div>
          <h1 className="portal-page-title">Uniform Catalogue</h1>
          <p className="portal-page-sub">
            Add uniform garments, accessories, sizes, photos, and class grade targeting.
          </p>
        </div>
        <button type="button" className="portal-btn portal-btn-primary" onClick={openCreateModal}>
          <Plus width={16} height={16} />
          <span>Add Uniform Item</span>
        </button>
      </div>

      <div className="portal-card">
        {/* Filters */}
        <div className="portal-filters-row">
          <div className="portal-search-box">
            <Search width={16} height={16} className="portal-search-icon" />
            <input
              type="text"
              placeholder="Search by uniform name..."
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

          <select
            className="portal-select"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            className="portal-select"
            value={genderFilter}
            onChange={(e) => setGenderFilter(e.target.value)}
          >
            <option value="">All Genders</option>
            <option value="boy">Boy</option>
            <option value="girl">Girl</option>
            <option value="unisex">Unisex</option>
          </select>

          <select
            className="portal-select"
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
          >
            <option value="">All Classes</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((c) => (
              <option key={c} value={String(c)}>
                Class {c}
              </option>
            ))}
          </select>
        </div>

        {/* Content Table */}
        {isLoading ? (
          <div>
            <div className="portal-skeleton-row" />
            <div className="portal-skeleton-row" />
            <div className="portal-skeleton-row" />
          </div>
        ) : error ? (
          <div className="portal-alert-error">
            Failed to load catalogue: {error instanceof Error ? error.message : 'Unknown error'}
          </div>
        ) : products.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ink-soft)' }}>
            <div style={{ fontWeight: 600, fontSize: '15px' }}>No uniform items found</div>
            <div style={{ fontSize: '13px', marginTop: '4px' }}>
              Try adjusting your filter settings or create a new uniform item.
            </div>
          </div>
        ) : (
          <div className="portal-table-container">
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>School</th>
                  <th>Category / Subtype</th>
                  <th>Gender</th>
                  <th>Classes</th>
                  <th>Selling Price</th>
                  <th>Sizes</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const firstPhoto = p.images && p.images.length > 0 ? p.images[0] : null;
                  return (
                    <tr key={p.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          {firstPhoto ? (
                            <img
                              src={firstPhoto}
                              alt={p.name}
                              style={{
                                width: '38px',
                                height: '38px',
                                objectFit: 'cover',
                                borderRadius: 'var(--radius-sm)',
                                border: '1px solid var(--line)',
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                width: '38px',
                                height: '38px',
                                borderRadius: 'var(--radius-sm)',
                                background: 'var(--paper-sunk)',
                                display: 'grid',
                                placeItems: 'center',
                                color: 'var(--ink-faint)',
                              }}
                            >
                              <Camera width={18} height={18} />
                            </div>
                          )}
                          <div>
                            <div style={{ fontWeight: 700 }}>{p.name}</div>
                            {p.description && (
                              <div style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>
                                {p.description.slice(0, 36)}
                                {p.description.length > 36 ? '...' : ''}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span style={{ fontSize: '12px', fontWeight: 600 }}>
                          {p.school_name || 'Generic (All Schools)'}
                        </span>
                      </td>
                      <td>
                        <div>{p.category_name || '-'}</div>
                        {p.product_type && (
                          <span
                            style={{
                              fontSize: '10px',
                              background: '#f1f5f9',
                              color: '#475569',
                              padding: '1px 5px',
                              borderRadius: 'var(--radius-sm)',
                              fontWeight: 600,
                            }}
                          >
                            {p.product_type}
                          </span>
                        )}
                      </td>
                      <td>
                        <span style={{ textTransform: 'capitalize' }}>{p.gender}</span>
                      </td>
                      <td>
                        {p.class_from != null && p.class_to != null ? (
                          <span>
                            Class {p.class_from} - {p.class_to}
                          </span>
                        ) : p.class_from != null ? (
                          <span>Class {p.class_from}+</span>
                        ) : (
                          <span>All Classes</span>
                        )}
                      </td>
                      <td>
                        <strong>₹{Number(p.selling_price).toFixed(2)}</strong>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="portal-btn portal-btn-secondary portal-btn-sm"
                          onClick={() => openSizesModal(p)}
                        >
                          <span>{p.variants?.length || 0} Sizes</span>
                        </button>
                      </td>
                      <td>
                        {p.active ? (
                          <span className="portal-badge-active">Active</span>
                        ) : (
                          <span className="portal-badge-inactive">Inactive</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="portal-btn portal-btn-secondary portal-btn-sm"
                          onClick={() => openEditModal(p)}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Product Modal */}
      {itemModalOpen && (
        <div className="portal-modal-backdrop">
          <div className="portal-modal" style={{ maxWidth: '680px' }}>
            <div className="portal-modal-header">
              <h2 className="portal-modal-title">
                {editingProduct ? 'Edit Uniform Item' : 'Add New Uniform Item'}
              </h2>
              <button
                type="button"
                className="portal-btn portal-btn-secondary portal-btn-sm"
                onClick={() => setItemModalOpen(false)}
                aria-label="Close"
              >
                <X width={16} height={16} />
              </button>
            </div>

            <form onSubmit={handleProductSubmit}>
              <div className="portal-modal-body">
                {formError && <div className="portal-alert-error">{formError}</div>}
                {formSuccess && <div className="portal-alert-success">{formSuccess}</div>}

                <div className="portal-form-group">
                  <label className="portal-form-label">Item Name *</label>
                  <input
                    type="text"
                    required
                    className="portal-form-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. KV Summer Boys Half Sleeve Shirt"
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="portal-form-group">
                    <label className="portal-form-label">School</label>
                    <select
                      className="portal-form-input"
                      value={schoolId}
                      onChange={(e) => setSchoolId(e.target.value)}
                    >
                      <option value="">Generic (All Schools)</option>
                      {schools.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.code})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="portal-form-group">
                    <label className="portal-form-label">Category *</label>
                    <select
                      required
                      className="portal-form-input"
                      value={categoryId}
                      onChange={(e) => setCategoryId(e.target.value)}
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                  <div className="portal-form-group">
                    <label className="portal-form-label">Product Type</label>
                    <select
                      className="portal-form-input"
                      value={productType}
                      onChange={(e) => setProductType(e.target.value)}
                    >
                      <option value="">Standard Garment</option>
                      <option value="SOCKS">Socks</option>
                      <option value="BELT">Belt</option>
                      <option value="TIE">Tie</option>
                    </select>
                  </div>

                  <div className="portal-form-group">
                    <label className="portal-form-label">Gender *</label>
                    <select
                      className="portal-form-input"
                      value={gender}
                      onChange={(e) => setGender(e.target.value as any)}
                    >
                      <option value="unisex">Unisex</option>
                      <option value="boy">Boy</option>
                      <option value="girl">Girl</option>
                    </select>
                  </div>

                  <div className="portal-form-group">
                    <label className="portal-form-label">Selling Price (₹) *</label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      className="portal-form-input"
                      value={sellingPrice}
                      onChange={(e) => setSellingPrice(e.target.value)}
                      placeholder="e.g. 399.00"
                    />
                  </div>
                </div>

                {/* Class range */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="portal-form-group">
                    <label className="portal-form-label">Class From</label>
                    <input
                      type="number"
                      min="1"
                      max="12"
                      className="portal-form-input"
                      value={classFrom}
                      onChange={(e) =>
                        setClassFrom(e.target.value === '' ? '' : Number(e.target.value))
                      }
                      placeholder="e.g. 1"
                    />
                  </div>

                  <div className="portal-form-group">
                    <label className="portal-form-label">Class To</label>
                    <input
                      type="number"
                      min="1"
                      max="12"
                      className="portal-form-input"
                      value={classTo}
                      onChange={(e) =>
                        setClassTo(e.target.value === '' ? '' : Number(e.target.value))
                      }
                      placeholder="e.g. 5"
                    />
                  </div>
                </div>

                <div className="portal-form-group">
                  <label className="portal-form-label">Description</label>
                  <textarea
                    rows={2}
                    className="portal-form-input"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Material specs, washing instructions..."
                  />
                </div>

                {/* Photo Upload Section */}
                <div
                  style={{
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--radius-md)',
                    padding: '14px',
                    background: 'var(--paper)',
                  }}
                >
                  <label className="portal-form-label" style={{ marginBottom: '8px', display: 'block' }}>
                    Product Photo (Square 900x900 WebP)
                  </label>

                  <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                    {photoPreview ? (
                      <img
                        src={photoPreview}
                        alt="Preview"
                        style={{
                          width: '72px',
                          height: '72px',
                          objectFit: 'cover',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--line)',
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '72px',
                          height: '72px',
                          borderRadius: 'var(--radius-sm)',
                          background: 'var(--paper-sunk)',
                          display: 'grid',
                          placeItems: 'center',
                          color: 'var(--ink-faint)',
                        }}
                      >
                        <Camera width={24} height={24} />
                      </div>
                    )}

                    <div style={{ flex: 1 }}>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={handlePhotoSelect}
                        style={{ fontSize: '13px' }}
                      />
                      <div style={{ fontSize: '11px', color: 'var(--ink-soft)', marginTop: '4px' }}>
                        Accepts JPG, PNG or WebP up to 8 MB. Automatically converted to square 900x900 WebP.
                      </div>

                      {editingProduct && photoFile && (
                        <div style={{ marginTop: '8px' }}>
                          <button
                            type="button"
                            className="portal-btn portal-btn-secondary portal-btn-sm"
                            onClick={handlePhotoUploadNow}
                            disabled={uploadProgress}
                          >
                            {uploadProgress ? 'Processing & Uploading...' : 'Upload Now to Server'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {photoError && <div className="portal-form-error" style={{ marginTop: '8px' }}>{photoError}</div>}
                </div>

                <div className="portal-form-group" style={{ marginTop: '4px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={(e) => setActive(e.target.checked)}
                    />
                    <span>Active in Catalogue (visible to parents)</span>
                  </label>
                </div>
              </div>

              <div className="portal-modal-footer">
                <button
                  type="button"
                  className="portal-btn portal-btn-secondary"
                  onClick={() => setItemModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="portal-btn portal-btn-primary"
                  disabled={saveProductMutation.isPending || uploadProgress}
                >
                  {saveProductMutation.isPending
                    ? 'Saving...'
                    : editingProduct
                    ? 'Save Changes'
                    : 'Create Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manage Sizes / Variants Modal */}
      {sizesModalOpen && managingSizesProduct && (
        <div className="portal-modal-backdrop">
          <div className="portal-modal" style={{ maxWidth: '580px' }}>
            <div className="portal-modal-header">
              <div>
                <h2 className="portal-modal-title">Manage Sizes & SKUs</h2>
                <div style={{ fontSize: '12px', color: 'var(--ink-soft)' }}>
                  {managingSizesProduct.name}
                </div>
              </div>
              <button
                type="button"
                className="portal-btn portal-btn-secondary portal-btn-sm"
                onClick={() => setSizesModalOpen(false)}
                aria-label="Close"
              >
                <X width={16} height={16} />
              </button>
            </div>

            <div className="portal-modal-body">
              {sizeError && <div className="portal-alert-error">{sizeError}</div>}

              {/* Add Size Form */}
              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                  alignItems: 'flex-end',
                  padding: '12px',
                  background: 'var(--paper)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--line)',
                }}
              >
                <div style={{ flex: 1 }}>
                  <label className="portal-form-label" style={{ marginBottom: '4px', display: 'block' }}>
                    Add New Size
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 28, 30, 32, S, M, L, Free"
                    className="portal-form-input"
                    value={newSizeName}
                    onChange={(e) => setNewSizeName(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="portal-btn portal-btn-primary"
                  onClick={() => addVariantMutation.mutate()}
                  disabled={!newSizeName.trim() || addVariantMutation.isPending}
                >
                  <Plus width={15} height={15} />
                  <span>{addVariantMutation.isPending ? 'Adding...' : 'Add Size'}</span>
                </button>
              </div>

              {/* Existing Sizes List */}
              <div style={{ marginTop: '8px' }}>
                <h3 style={{ fontSize: '13px', fontWeight: 700, margin: '0 0 8px 0' }}>
                  Existing Size Variants
                </h3>

                {(!managingSizesProduct.variants || managingSizesProduct.variants.length === 0) ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--ink-soft)', fontSize: '13px' }}>
                    No sizes created yet. Add sizes above to make this garment purchasable.
                  </div>
                ) : (
                  <div className="portal-table-container">
                    <table className="portal-table">
                      <thead>
                        <tr>
                          <th>Size</th>
                          <th>Generated SKU</th>
                          <th>Status</th>
                          <th style={{ textAlign: 'right' }}>Toggle</th>
                        </tr>
                      </thead>
                      <tbody>
                        {managingSizesProduct.variants.map((v) => (
                          <tr key={v.id}>
                            <td style={{ fontWeight: 700 }}>{v.size}</td>
                            <td>
                              <code style={{ fontSize: '11px' }}>{v.sku}</code>
                            </td>
                            <td>
                              {v.active ? (
                                <span className="portal-badge-active">Active</span>
                              ) : (
                                <span className="portal-badge-inactive">Disabled</span>
                              )}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <button
                                type="button"
                                className="portal-btn portal-btn-secondary portal-btn-sm"
                                onClick={() =>
                                  toggleVariantMutation.mutate({
                                    variantId: v.id,
                                    active: !v.active,
                                  })
                                }
                              >
                                {v.active ? 'Disable' : 'Enable'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="portal-modal-footer">
              <button
                type="button"
                className="portal-btn portal-btn-secondary"
                onClick={() => setSizesModalOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
