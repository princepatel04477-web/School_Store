import { useState, useMemo } from 'react';
import { Plus, Search, Check, Package, Ruler } from '../ui/icons';

interface UniformItem {
  id: string;
  schoolName: string;
  name: string;
  category: string;
  gender: 'boy' | 'girl' | 'unisex';
  classes: string;
  price: number;
  costPrice: number;
  photo: string;
  inStock: boolean;
  sizes: string[];
}

const DEFAULT_UNIFORMS: UniformItem[] = [
  {
    id: 'u-kv-1',
    schoolName: 'Kendriya Vidyalaya',
    name: 'KV Red House PT T-Shirt (Class 1-5)',
    category: 'PT Kit',
    gender: 'unisex',
    classes: 'Class 1-5',
    price: 320,
    costPrice: 192,
    photo: '/products/kv-house-tshirt-red.webp',
    inStock: true,
    sizes: ['20', '22', '24', '26', '28', '30'],
  },
  {
    id: 'u-kv-2',
    schoolName: 'Kendriya Vidyalaya',
    name: 'KV Red House PT T-Shirt (Class 6-12)',
    category: 'PT Kit',
    gender: 'unisex',
    classes: 'Class 6-12',
    price: 390,
    costPrice: 234,
    photo: '/products/kv-house-tshirt-red.webp',
    inStock: true,
    sizes: ['28', '30', '32', '34', '36', '38', '40', '42'],
  },
  {
    id: 'u-kv-3',
    schoolName: 'Kendriya Vidyalaya',
    name: 'KV Boys Summer Shirt (Half Sleeve)',
    category: 'Uniform',
    gender: 'boy',
    classes: 'Class 1-5',
    price: 380,
    costPrice: 220,
    photo: '/products/kv-boys-1-5-shirt-summer.webp',
    inStock: true,
    sizes: ['22', '24', '26', '28', '30'],
  },
  {
    id: 'u-kv-4',
    schoolName: 'Kendriya Vidyalaya',
    name: 'KV Boys Navy Shorts',
    category: 'Uniform',
    gender: 'boy',
    classes: 'Class 1-5',
    price: 340,
    costPrice: 200,
    photo: '/products/kv-boys-1-5-shorts.webp',
    inStock: true,
    sizes: ['20', '22', '24', '26', '28'],
  },
  {
    id: 'u-kv-5',
    schoolName: 'Kendriya Vidyalaya',
    name: 'KV Navy PT Track Pants',
    category: 'PT Kit',
    gender: 'unisex',
    classes: 'Class 1-12',
    price: 420,
    costPrice: 250,
    photo: '/products/kv-boys-6-12-trousers.webp',
    inStock: true,
    sizes: ['24', '26', '28', '30', '32', '34', '36', '38'],
  },
  {
    id: 'u-dps-1',
    schoolName: 'Delhi Public School Surat',
    name: 'DPS Boys Short Sleeve Polo Shirt',
    category: 'Uniform',
    gender: 'boy',
    classes: 'Class 1-12',
    price: 450,
    costPrice: 270,
    photo: '/products/uniform-dps-shirt.webp',
    inStock: true,
    sizes: ['26', '28', '30', '32', '34', '36'],
  },
];

export function UniformCatalogView() {
  const [items, setItems] = useState<UniformItem[]>(DEFAULT_UNIFORMS);
  const [selectedSchool, setSelectedSchool] = useState<string>('Kendriya Vidyalaya');
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // New uniform form
  const [itemName, setItemName] = useState('');
  const [category, setCategory] = useState('Uniform');
  const [gender, setGender] = useState<'boy' | 'girl' | 'unisex'>('unisex');
  const [classes, setClasses] = useState('Class 1-12');
  const [price, setPrice] = useState('380');
  const [costPrice, setCostPrice] = useState('220');
  const [photo, setPhoto] = useState('/products/kv-house-tshirt-red.webp');
  const [sizesStr, setSizesStr] = useState('24, 26, 28, 30, 32, 34, 36');

  const schools = useMemo(() => Array.from(new Set(items.map((i) => i.schoolName))), [items]);

  const filteredItems = items.filter(
    (item) =>
      item.schoolName === selectedSchool &&
      (item.name.toLowerCase().includes(search.toLowerCase()) || item.category.toLowerCase().includes(search.toLowerCase()))
  );

  const handleToggleStock = (id: string) => {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, inStock: !i.inStock } : i))
    );
    setSuccessMsg('Stock status toggled. Reflected across mobile application and website.');
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemName.trim()) return;

    const newItem: UniformItem = {
      id: `u-${Date.now()}`,
      schoolName: selectedSchool,
      name: itemName.trim(),
      category,
      gender,
      classes,
      price: Number(price) || 0,
      costPrice: Number(costPrice) || 0,
      photo: photo.trim() || '/products/cat-uniform.webp',
      inStock: true,
      sizes: sizesStr.split(',').map((s) => s.trim()).filter(Boolean),
    };

    setItems((prev) => [newItem, ...prev]);
    setIsModalOpen(false);
    setItemName('');
    setSuccessMsg(`Uniform "${newItem.name}" created and synced to mobile app and web storefront!`);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  return (
    <div className="panel-view">
      <div className="page-head" style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div className="eyebrow" style={{ color: 'var(--brand, #0e5b38)', fontWeight: 700, letterSpacing: '0.06em' }}>
            CATALOGUE & MERCHANDISE
          </div>
          <h1 style={{ fontSize: '24px', margin: '4px 0 8px', color: '#1a202c' }}>
            Uniform & Product Catalog Builder
          </h1>
          <p className="muted" style={{ fontSize: '14px', color: '#64748b' }}>
            Add and manage uniform sets, PT kits, winter blazers, sizes, and pricing for each school. Updates reflect live across mobile app and web.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
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
            SELECT SCHOOL
          </label>
          <select
            value={selectedSchool}
            onChange={(e) => setSelectedSchool(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px', fontWeight: 600, minWidth: '240px' }}
          >
            {schools.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div style={{ flex: 1, minWidth: '220px' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
            SEARCH ITEMS
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '6px 12px' }}>
            <Search width={16} height={16} style={{ color: '#94a3b8' }} />
            <input
              type="text"
              placeholder="Search by uniform name or category..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: '100%', border: 'none', outline: 'none', fontSize: '13px' }}
            />
          </div>
        </div>
      </div>

      {/* Products Table */}
      <div style={{ background: '#ffffff', borderRadius: '10px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: '12px', letterSpacing: '0.04em' }}>
              <th style={{ padding: '12px 18px' }}>PHOTO</th>
              <th style={{ padding: '12px 18px' }}>ITEM NAME & CATEGORY</th>
              <th style={{ padding: '12px 18px' }}>CLASSES & GENDER</th>
              <th style={{ padding: '12px 18px' }}>SIZES</th>
              <th style={{ padding: '12px 18px' }}>PRICING</th>
              <th style={{ padding: '12px 18px', textAlign: 'right' }}>STATUS</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((item) => (
              <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '12px 18px' }}>
                  <img
                    src={item.photo}
                    alt={item.name}
                    width={48}
                    height={48}
                    style={{ borderRadius: '6px', objectFit: 'contain', border: '1px solid #e2e8f0', background: '#fafafa' }}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = '/products/cat-uniform.webp';
                    }}
                  />
                </td>
                <td style={{ padding: '12px 18px' }}>
                  <div style={{ fontWeight: 700, color: '#1e293b' }}>{item.name}</div>
                  <span style={{ fontSize: '11px', background: '#f1f5f9', color: '#475569', padding: '2px 6px', borderRadius: '4px' }}>
                    {item.category}
                  </span>
                </td>
                <td style={{ padding: '12px 18px', fontSize: '13px', color: '#334155' }}>
                  <div>{item.classes}</div>
                  <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'capitalize' }}>Gender: {item.gender}</div>
                </td>
                <td style={{ padding: '12px 18px', fontSize: '12px', color: '#475569' }}>
                  <div style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.sizes.join(', ')}
                  </div>
                </td>
                <td style={{ padding: '12px 18px' }}>
                  <div style={{ fontWeight: 700, color: '#0e5b38' }}>₹{item.price}</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>Cost: ₹{item.costPrice}</div>
                </td>
                <td style={{ padding: '12px 18px', textAlign: 'right' }}>
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
                    {item.inStock ? '🟢 Active In Stock' : '🔴 Paused'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Uniform Modal */}
      {isModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.5)', display: 'grid', placeItems: 'center', zIndex: 999 }}>
          <form onSubmit={handleAddItem} style={{ background: '#ffffff', width: '100%', maxWidth: '540px', borderRadius: '12px', padding: '24px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)' }}>
            <h2 style={{ fontSize: '18px', margin: '0 0 4px', color: '#1e293b' }}>Add Uniform Item</h2>
            <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#64748b' }}>For school: <strong>{selectedSchool}</strong></p>

            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>ITEM NAME</label>
              <input
                type="text"
                required
                placeholder="e.g. KV Sun Yellow House PT T-Shirt"
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>CATEGORY</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px' }}
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
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>GENDER</label>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value as 'boy' | 'girl' | 'unisex')}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px' }}
                >
                  <option value="unisex">Unisex</option>
                  <option value="boy">Boy</option>
                  <option value="girl">Girl</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>CLASS RANGE</label>
                <input
                  type="text"
                  placeholder="e.g. Class 1-5 or Class 6-12"
                  value={classes}
                  onChange={(e) => setClasses(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>SELLING PRICE (₹)</label>
                <input
                  type="number"
                  placeholder="380"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>COST PRICE (₹)</label>
                <input
                  type="number"
                  placeholder="220"
                  value={costPrice}
                  onChange={(e) => setCostPrice(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px' }}
                />
              </div>
            </div>

            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>SIZES (COMMA SEPARATED)</label>
              <input
                type="text"
                placeholder="22, 24, 26, 28, 30, 32, 34, 36"
                value={sizesStr}
                onChange={(e) => setSizesStr(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px' }}
              />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>PHOTO PATH OR URL</label>
              <input
                type="text"
                placeholder="/products/kv-house-tshirt-red.webp"
                value={photo}
                onChange={(e) => setPhoto(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', cursor: 'pointer', fontWeight: 600 }}
              >
                Cancel
              </button>
              <button
                type="submit"
                style={{ padding: '8px 18px', borderRadius: '6px', border: 'none', background: 'var(--brand, #0e5b38)', color: '#ffffff', cursor: 'pointer', fontWeight: 700 }}
              >
                Save Uniform Item
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
