import { useState, useMemo, useEffect, useRef, type FormEvent, type ChangeEvent } from 'react';
import {
  type PortalUniformItem,
  getPortalUniforms,
  savePortalUniform,
  deletePortalUniform,
  togglePortalUniformStock,
  getPortalSchools,
  readFileAsDataUrl,
  PORTAL_EVENT,
} from '../../data/portalStore';
import { Plus, Search, Check, Package, AlertCircle } from '../ui/icons';

export function UniformCatalogView() {
  const [items, setItems] = useState<PortalUniformItem[]>(getPortalUniforms);
  const [portalSchools, setPortalSchools] = useState(getPortalSchools);
  const [selectedSchool, setSelectedSchool] = useState<string>('Kendriya Vidyalaya');
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form Fields
  const [itemName, setItemName] = useState('');
  const [formSchool, setFormSchool] = useState('Kendriya Vidyalaya');
  const [category, setCategory] = useState('Uniform');
  const [gender, setGender] = useState<'boy' | 'girl' | 'unisex'>('unisex');
  const [classes, setClasses] = useState('Class 1-5');
  const [price, setPrice] = useState('380');
  const [costPrice, setCostPrice] = useState('220');
  const [sizesStr, setSizesStr] = useState('22, 24, 26, 28, 30');
  const [photoPreview, setPhotoPreview] = useState<string>('');
  const [photoFileName, setPhotoFileName] = useState<string>('');
  const [uploadLoading, setUploadLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Listen to portal changes across views
  useEffect(() => {
    const refresh = () => {
      setItems(getPortalUniforms());
      setPortalSchools(getPortalSchools());
    };
    window.addEventListener(PORTAL_EVENT, refresh);
    return () => window.removeEventListener(PORTAL_EVENT, refresh);
  }, []);

  const schoolNames = useMemo(() => {
    const fromSchools = portalSchools.map((s) => s.name);
    const fromItems = items.map((i) => i.schoolName);
    return Array.from(new Set([...fromSchools, ...fromItems])).filter(Boolean);
  }, [portalSchools, items]);

  useEffect(() => {
    if (schoolNames.length > 0 && !schoolNames.includes(selectedSchool)) {
      setSelectedSchool(schoolNames[0]);
    }
  }, [schoolNames, selectedSchool]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchSchool =
        selectedSchool === 'ALL_SCHOOLS' ||
        item.schoolName.toLowerCase() === selectedSchool.toLowerCase();
      const matchSearch =
        !search.trim() ||
        item.name.toLowerCase().includes(search.toLowerCase()) ||
        item.category.toLowerCase().includes(search.toLowerCase()) ||
        item.classes.toLowerCase().includes(search.toLowerCase());
      return matchSchool && matchSearch;
    });
  }, [items, selectedSchool, search]);

  const handleOpenAddModal = () => {
    setEditingId(null);
    setItemName('');
    setFormSchool(selectedSchool === 'ALL_SCHOOLS' ? (schoolNames[0] || 'Kendriya Vidyalaya') : selectedSchool);
    setCategory('Uniform');
    setGender('unisex');
    setClasses('Class 1-5');
    setPrice('380');
    setCostPrice('220');
    setSizesStr('22, 24, 26, 28, 30');
    setPhotoPreview('/products/kv-house-tshirt-red.webp');
    setPhotoFileName('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (item: PortalUniformItem) => {
    setEditingId(item.id);
    setItemName(item.name);
    setFormSchool(item.schoolName);
    setCategory(item.category);
    setGender(item.gender);
    setClasses(item.classes);
    setPrice(String(item.price));
    setCostPrice(String(item.costPrice));
    setSizesStr(item.sizes.join(', '));
    setPhotoPreview(item.photo);
    setPhotoFileName('');
    setIsModalOpen(true);
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploadLoading(true);
      setPhotoFileName(file.name);
      const dataUrl = await readFileAsDataUrl(file);
      setPhotoPreview(dataUrl);
    } catch (err) {
      alert('Could not read image file. Please try another PNG or JPG image.');
    } finally {
      setUploadLoading(false);
    }
  };

  const handleToggleStock = (id: string) => {
    const updated = togglePortalUniformStock(id);
    setItems(updated);
  };

  const handleDeleteItem = (id: string, name: string) => {
    if (window.confirm(`Are you sure you want to delete "${name}"?`)) {
      const updated = deletePortalUniform(id);
      setItems(updated);
      setSuccessMsg(`Deleted "${name}" from catalog.`);
      setTimeout(() => setSuccessMsg(null), 3500);
    }
  };

  const handleSaveItem = (e: FormEvent) => {
    e.preventDefault();
    if (!itemName.trim()) return;

    const parsedSizes = sizesStr
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const newItem: PortalUniformItem = {
      id: editingId || `u-custom-${Date.now()}`,
      schoolName: formSchool,
      name: itemName.trim(),
      category,
      gender,
      classes: classes.trim() || 'All Classes',
      price: Number(price) || 0,
      costPrice: Number(costPrice) || 0,
      photo: photoPreview || '/products/cat-uniform.webp',
      inStock: true,
      sizes: parsedSizes.length > 0 ? parsedSizes : ['Standard'],
      createdAt: new Date().toISOString(),
    };

    const updated = savePortalUniform(newItem);
    setItems(updated);
    setIsModalOpen(false);
    setSuccessMsg(
      editingId
        ? `Updated "${newItem.name}". Synced live across website and app!`
        : `Added new uniform "${newItem.name}". Synced live across website and app!`
    );
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  return (
    <div className="panel-view">
      {/* Header */}
      <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ color: 'var(--brand, #0e5b38)', fontWeight: 700, fontSize: '12px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            UNIFORM INVENTORY & PRICING
          </div>
          <h1 style={{ fontSize: '24px', margin: '4px 0 8px', color: '#0f172a', fontWeight: 800 }}>
            Uniform Catalog & Sets
          </h1>
          <p style={{ margin: 0, fontSize: '14px', color: '#64748b' }}>
            Add new garments, upload photos directly from your computer, configure size curves and manage prices.
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenAddModal}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: 'var(--brand, #0e5b38)',
            color: '#ffffff',
            padding: '10px 18px',
            borderRadius: '8px',
            border: 'none',
            fontWeight: 700,
            fontSize: '14px',
            cursor: 'pointer',
            boxShadow: '0 2px 4px rgba(14, 91, 56, 0.2)',
          }}
        >
          <Plus width={18} height={18} />
          <span>Add Uniform Item</span>
        </button>
      </div>

      {successMsg && (
        <div style={{ background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', padding: '12px 18px', borderRadius: '8px', marginBottom: '20px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Check width={18} height={18} />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Filter and School selector */}
      <div style={{ display: 'flex', gap: '16px', background: '#ffffff', padding: '16px', borderRadius: '10px', border: '1px solid #e2e8f0', marginBottom: '24px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
            FILTER BY SCHOOL
          </label>
          <select
            value={selectedSchool}
            onChange={(e) => setSelectedSchool(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px', fontWeight: 600, minWidth: '240px' }}
          >
            <option value="ALL_SCHOOLS">All Schools ({items.length} items)</option>
            {schoolNames.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div style={{ flex: 1, minWidth: '220px' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
            SEARCH GARMENTS
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '6px 12px' }}>
            <Search width={16} height={16} style={{ color: '#94a3b8' }} />
            <input
              type="text"
              placeholder="Search by garment name, category, or class..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: '100%', border: 'none', outline: 'none', fontSize: '13px' }}
            />
          </div>
        </div>
      </div>

      {/* Products Table */}
      <div style={{ background: '#ffffff', borderRadius: '10px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: '12px', letterSpacing: '0.04em' }}>
              <th style={{ padding: '12px 18px' }}>PHOTO</th>
              <th style={{ padding: '12px 18px' }}>GARMENT & CATEGORY</th>
              <th style={{ padding: '12px 18px' }}>SCHOOL & CLASSES</th>
              <th style={{ padding: '12px 18px' }}>SIZES</th>
              <th style={{ padding: '12px 18px' }}>PRICE / COST</th>
              <th style={{ padding: '12px 18px' }}>STOCK</th>
              <th style={{ padding: '12px 18px', textAlign: 'right' }}>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '48px 24px', textAlign: 'center', color: '#94a3b8' }}>
                  <Package width={36} height={36} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
                  <p style={{ margin: 0, fontWeight: 600 }}>No uniform items found matching the selected filter.</p>
                </td>
              </tr>
            ) : (
              filteredItems.map((item) => (
                <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px 18px' }}>
                    <img
                      src={item.photo}
                      alt={item.name}
                      width={52}
                      height={52}
                      style={{ borderRadius: '8px', objectFit: 'contain', border: '1px solid #e2e8f0', background: '#fafafa' }}
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src = '/products/cat-uniform.webp';
                      }}
                    />
                  </td>
                  <td style={{ padding: '12px 18px' }}>
                    <div style={{ fontWeight: 700, color: '#0f172a' }}>{item.name}</div>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                      <span style={{ fontSize: '11px', background: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>
                        {item.category}
                      </span>
                      <span style={{ fontSize: '11px', background: '#eff6ff', color: '#1d4ed8', padding: '2px 8px', borderRadius: '4px', textTransform: 'capitalize' }}>
                        {item.gender}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: '12px 18px', fontSize: '13px' }}>
                    <div style={{ fontWeight: 600, color: '#334155' }}>{item.schoolName}</div>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>{item.classes}</div>
                  </td>
                  <td style={{ padding: '12px 18px', fontSize: '12px', color: '#475569' }}>
                    <div style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.sizes.join(', ')}
                    </div>
                  </td>
                  <td style={{ padding: '12px 18px' }}>
                    <div style={{ fontWeight: 800, color: '#0e5b38', fontSize: '15px' }}>₹{item.price}</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>Cost: ₹{item.costPrice}</div>
                  </td>
                  <td style={{ padding: '12px 18px' }}>
                    <button
                      type="button"
                      onClick={() => handleToggleStock(item.id)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '9999px',
                        fontSize: '11px',
                        fontWeight: 700,
                        border: 'none',
                        cursor: 'pointer',
                        background: item.inStock ? '#ecfdf5' : '#fef2f2',
                        color: item.inStock ? '#065f46' : '#991b1b',
                      }}
                    >
                      {item.inStock ? '🟢 In Stock' : '🔴 Paused'}
                    </button>
                  </td>
                  <td style={{ padding: '12px 18px', textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => handleOpenEditModal(item)}
                        style={{
                          padding: '5px 10px',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          background: '#ffffff',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          color: '#334155',
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteItem(item.id, item.name)}
                        style={{
                          padding: '5px 10px',
                          borderRadius: '6px',
                          border: '1px solid #fecaca',
                          background: '#fff5f5',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          color: '#ef4444',
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add / Edit Uniform Modal */}
      {isModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.55)', display: 'grid', placeItems: 'center', zIndex: 999, padding: '16px' }}>
          <form onSubmit={handleSaveItem} style={{ background: '#ffffff', width: '100%', maxWidth: '580px', borderRadius: '14px', padding: '28px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)' }}>
            <h2 style={{ fontSize: '20px', margin: '0 0 6px', color: '#0f172a', fontWeight: 800 }}>
              {editingId ? 'Edit Uniform Item' : 'Add New Uniform Item'}
            </h2>
            <p style={{ margin: '0 0 20px', fontSize: '13px', color: '#64748b' }}>
              Configure product details and upload photo directly from your computer.
            </p>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>TARGET SCHOOL</label>
              <select
                value={formSchool}
                onChange={(e) => setFormSchool(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1.5px solid #cbd5e1', fontSize: '14px', fontWeight: 600 }}
              >
                {schoolNames.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>ITEM NAME</label>
              <input
                type="text"
                required
                placeholder="e.g. KV Red House PT T-Shirt (Half Sleeve)"
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1.5px solid #cbd5e1', fontSize: '14px', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '14px', marginBottom: '16px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>CATEGORY</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1.5px solid #cbd5e1', fontSize: '14px' }}
                >
                  <option value="Uniform">Uniform</option>
                  <option value="PT Kit">PT Kit</option>
                  <option value="Winter Wear">Winter Wear</option>
                  <option value="Accessories">Accessories (Belt/Tie/Socks)</option>
                  <option value="Shoes">Shoes</option>
                  <option value="Stationery">Stationery</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>GENDER</label>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value as 'boy' | 'girl' | 'unisex')}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1.5px solid #cbd5e1', fontSize: '14px' }}
                >
                  <option value="unisex">Unisex</option>
                  <option value="boy">Boy</option>
                  <option value="girl">Girl</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '14px', marginBottom: '16px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>CLASS RANGE</label>
                <input
                  type="text"
                  placeholder="e.g. Class 1-5"
                  value={classes}
                  onChange={(e) => setClasses(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1.5px solid #cbd5e1', fontSize: '14px', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>SELLING PRICE (₹)</label>
                <input
                  type="number"
                  placeholder="380"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1.5px solid #cbd5e1', fontSize: '14px', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>COST PRICE (₹)</label>
                <input
                  type="number"
                  placeholder="220"
                  value={costPrice}
                  onChange={(e) => setCostPrice(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1.5px solid #cbd5e1', fontSize: '14px', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            <div style={{ marginBottom: '18px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>SIZES (COMMA SEPARATED)</label>
              <input
                type="text"
                placeholder="22, 24, 26, 28, 30, 32, 34, 36"
                value={sizesStr}
                onChange={(e) => setSizesStr(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1.5px solid #cbd5e1', fontSize: '14px', boxSizing: 'border-box' }}
              />
            </div>

            {/* COMPUTER IMAGE UPLOAD SECTION */}
            <div style={{ marginBottom: '24px', background: '#f8fafc', padding: '18px', borderRadius: '10px', border: '1.5px dashed #cbd5e1' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#0f172a', marginBottom: '6px' }}>
                📷 UPLOAD PHOTO FROM YOUR COMPUTER
              </label>
              <p style={{ margin: '0 0 14px', fontSize: '12px', color: '#64748b' }}>
                Select any image file from your device (PNG, JPG, JPEG, WebP, SVG). No path typing needed!
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/png, image/jpeg, image/jpg, image/webp, image/svg+xml"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />

              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                {/* Image preview */}
                <div
                  style={{
                    width: '84px',
                    height: '84px',
                    borderRadius: '8px',
                    border: '1.5px solid #e2e8f0',
                    background: '#ffffff',
                    display: 'grid',
                    placeItems: 'center',
                    overflow: 'hidden',
                  }}
                >
                  {photoPreview ? (
                    <img src={photoPreview} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : (
                    <Package width={32} height={32} style={{ color: '#cbd5e1' }} />
                  )}
                </div>

                <div style={{ flex: 1, minWidth: '200px' }}>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadLoading}
                    style={{
                      background: 'var(--brand, #0e5b38)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '9px 16px',
                      fontSize: '13px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <span>{uploadLoading ? 'Processing…' : photoPreview ? 'Choose Different Image' : 'Browse Files on Computer'}</span>
                  </button>

                  {photoFileName && (
                    <div style={{ fontSize: '12px', color: '#059669', fontWeight: 600, marginTop: '6px' }}>
                      ✓ Selected file: {photoFileName}
                    </div>
                  )}

                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                    Supports high-resolution photos. Image is automatically optimized.
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                style={{ padding: '10px 18px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#ffffff', cursor: 'pointer', fontWeight: 600 }}
              >
                Cancel
              </button>
              <button
                type="submit"
                style={{ padding: '10px 22px', borderRadius: '8px', border: 'none', background: 'var(--brand, #0e5b38)', color: '#ffffff', cursor: 'pointer', fontWeight: 700 }}
              >
                {editingId ? 'Update Uniform Item' : 'Save Uniform Item'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
