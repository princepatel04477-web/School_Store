// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminPortal from './AdminPortal';
import { UniformCatalogView } from '../components/admin/UniformCatalogView';
import { portalApi } from '../api';

// jsdom has no canvas: hand the photo back as a small JPEG.
vi.mock('../utils/imageCompression', () => ({
  compressImage: vi.fn(async () => ({ blob: new Blob(['jpeg-bytes'], { type: 'image/jpeg' }), width: 10, height: 10 })),
}));

// jsdom has no object URLs (used for the photo preview).
if (!URL.createObjectURL) (URL as any).createObjectURL = () => 'blob:preview';

// Mock auth hook
const mockUser = {
  current: null as any,
  loading: false,
};

vi.mock('../auth', () => ({
  useAuth: () => ({
    user: mockUser.current,
    loading: mockUser.loading,
    signOut: vi.fn(),
  }),
}));

import { useAuth } from '../auth';
import { homeFor } from '../App';

function TestGuard({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const { user, loading } = useAuth();
  if (loading) return <div>Loading...</div>;
  if (!user) return <div>Redirected to /login</div>;
  if (roles && !roles.includes(user.role)) return <div>Redirected to {homeFor(user.role)}</div>;
  return <>{children}</>;
}

function renderWithProviders(ui: React.ReactElement, initialEntries = ['/portal']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        {ui}
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Uniform Portal Frontend Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.current = null;
    mockUser.loading = false;
  });

  afterEach(() => {
    cleanup();
  });

  it('/portal redirects to sign-in when signed out', () => {
    mockUser.current = null;

    renderWithProviders(
      <Routes>
        <Route
          path="/portal/*"
          element={
            <TestGuard roles={['BOSS', 'ADMIN']}>
              <AdminPortal />
            </TestGuard>
          }
        />
        <Route path="/login" element={<div>Sign In Page</div>} />
      </Routes>
    );

    expect(screen.getByText('Redirected to /login')).toBeTruthy();
  });

  it('/portal refuses a PARENT and redirects to parent home', () => {
    mockUser.current = {
      id: 'parent-123',
      username: 'test_parent',
      role: 'PARENT',
    };

    renderWithProviders(
      <Routes>
        <Route
          path="/portal/*"
          element={
            <TestGuard roles={['BOSS', 'ADMIN']}>
              <AdminPortal />
            </TestGuard>
          }
        />
      </Routes>
    );

    expect(screen.getByText('Redirected to /account')).toBeTruthy();
  });

  it('/portal renders successfully for BOSS and displays navigation tabs', async () => {
    mockUser.current = {
      id: 'boss-123',
      username: 'test_boss',
      role: 'BOSS',
    };

    vi.spyOn(portalApi, 'products').mockResolvedValue({
      results: [],
      next: null,
      previous: null,
    } as any);

    vi.spyOn(portalApi, 'categories').mockResolvedValue({
      results: [
        { id: 'cat-1', name: 'Uniforms', slug: 'uniforms', display_order: 1, active: true },
      ],
      next: null,
      previous: null,
    } as any);

    vi.spyOn(portalApi, 'schools').mockResolvedValue({
      results: [],
      next: null,
      previous: null,
    } as any);

    renderWithProviders(
      <Routes>
        <Route
          path="/portal/*"
          element={
            <TestGuard roles={['BOSS', 'ADMIN']}>
              <AdminPortal />
            </TestGuard>
          }
        />
      </Routes>
    );

    expect(screen.getByText('Uniform Operations Portal')).toBeTruthy();
    expect(screen.getAllByText('Uniform Catalogue').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Schools & Campuses')).toBeTruthy();
    expect(screen.getByText('City Stock & Availability')).toBeTruthy();
  });

  it('catalogue form sends the right payload and shows the API error message', async () => {
    mockUser.current = {
      id: 'boss-123',
      username: 'test_boss',
      role: 'BOSS',
    };

    vi.spyOn(portalApi, 'categories').mockResolvedValue({
      results: [
        { id: 'cat-1', name: 'Uniforms', slug: 'uniforms', display_order: 1, active: true },
      ],
      next: null,
      previous: null,
    } as any);

    vi.spyOn(portalApi, 'schools').mockResolvedValue({
      results: [
        { id: 'sch-1', name: 'Kendriya Vidyalaya', code: 'KV-01', active: true } as any,
      ],
      next: null,
      previous: null,
    } as any);

    vi.spyOn(portalApi, 'products').mockResolvedValue({
      results: [],
      next: null,
      previous: null,
    } as any);

    // Mock createProduct rejection with specific API error
    const createSpy = vi.spyOn(portalApi, 'createProduct').mockRejectedValueOnce(
      new Error('A class range is only valid on school-specific items.')
    );

    renderWithProviders(<UniformCatalogView />);

    // Open add item modal
    const addButton = await screen.findByRole('button', { name: /Add Uniform Item/i });
    fireEvent.click(addButton);

    // Fill in required fields
    const nameInput = screen.getByPlaceholderText('e.g. KV Summer Boys Half Sleeve Shirt');
    fireEvent.change(nameInput, { target: { value: 'KV Track Pants' } });

    const priceInput = screen.getByPlaceholderText('e.g. 399.00');
    fireEvent.change(priceInput, { target: { value: '450.00' } });

    // Submit form
    const submitBtn = screen.getByRole('button', { name: /Create Product/i });
    fireEvent.click(submitBtn);

    // Verify payload sent
    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'KV Track Pants',
          selling_price: '450.00',
          active: true,
        })
      );
    });

    // Verify error message is rendered
    expect(
      await screen.findByText('A class range is only valid on school-specific items.')
    ).toBeTruthy();
  });

  it('renders Delete button for uniform items and invokes deleteProduct API', async () => {
    mockUser.current = {
      id: 'boss-123',
      username: 'test_boss',
      role: 'BOSS',
    };

    vi.spyOn(portalApi, 'categories').mockResolvedValue({
      results: [{ id: 'cat-1', name: 'Uniforms', slug: 'uniforms', display_order: 1, active: true }],
      next: null,
      previous: null,
    } as any);

    vi.spyOn(portalApi, 'schools').mockResolvedValue({
      results: [],
      next: null,
      previous: null,
    } as any);

    vi.spyOn(portalApi, 'products').mockResolvedValue({
      results: [
        {
          id: 'prod-delete-test',
          name: 'Deletable Blazer',
          selling_price: '599.00',
          active: true,
          category: 'cat-1',
          gender: 'unisex',
          variants: [],
          images: [],
        },
      ],
      next: null,
      previous: null,
    } as any);

    const deleteSpy = vi.spyOn(portalApi, 'deleteProduct').mockResolvedValue(undefined as any);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderWithProviders(<UniformCatalogView />);

    const deleteButton = await screen.findByRole('button', { name: /^Delete$/i });
    expect(deleteButton).toBeTruthy();

    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith('prod-delete-test');
    });
  });

  it('creates the sizes typed in the item form, once each, with unique SKUs', async () => {
    mockUser.current = { id: 'boss-123', username: 'test_boss', role: 'BOSS' };

    vi.spyOn(portalApi, 'categories').mockResolvedValue({
      results: [{ id: 'cat-1', name: 'Uniforms', slug: 'uniforms', display_order: 1, active: true }],
      next: null,
      previous: null,
    } as any);
    vi.spyOn(portalApi, 'schools').mockResolvedValue({
      results: [{ id: 'sch-1', name: 'Kendriya Vidyalaya', code: 'KV-01', active: true } as any],
      next: null,
      previous: null,
    } as any);
    vi.spyOn(portalApi, 'products').mockResolvedValue({ results: [], next: null, previous: null } as any);
    vi.spyOn(portalApi, 'createProduct').mockResolvedValue({
      id: 'abcd1234-0000-0000-0000-000000000000',
      name: 'Shirt',
      school: 'sch-1',
      variants: [],
    } as any);
    const variantSpy = vi
      .spyOn(portalApi, 'createVariant')
      .mockImplementation(async (body) => ({ id: `v-${body.size}`, ...body }) as any);

    renderWithProviders(<UniformCatalogView />);

    fireEvent.click(await screen.findByRole('button', { name: /Add Uniform Item/i }));
    fireEvent.change(screen.getByPlaceholderText('e.g. KV Summer Boys Half Sleeve Shirt'), {
      target: { value: 'Shirt' },
    });
    fireEvent.change(screen.getByPlaceholderText('e.g. 399.00'), { target: { value: '350.00' } });
    fireEvent.change(screen.getByLabelText('Sizes'), { target: { value: '22, 24 , 26, 24,' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Product/i }));

    await waitFor(() => expect(variantSpy).toHaveBeenCalledTimes(3));
    expect(variantSpy.mock.calls.map(([body]) => body.size)).toEqual(['22', '24', '26']);
    expect(variantSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        product: 'abcd1234-0000-0000-0000-000000000000',
        sku: 'KV-01-SHIRT-ABCD-22',
        active: true,
      })
    );
  });

  it('shows each item\'s sizes and a Sizes button inside the item cell', async () => {
    mockUser.current = { id: 'boss-123', username: 'test_boss', role: 'BOSS' };

    vi.spyOn(portalApi, 'categories').mockResolvedValue({ results: [], next: null, previous: null } as any);
    vi.spyOn(portalApi, 'schools').mockResolvedValue({ results: [], next: null, previous: null } as any);
    vi.spyOn(portalApi, 'products').mockResolvedValue({
      results: [
        {
          id: 'prod-1',
          name: 'Class 1 Shirt',
          selling_price: '350.00',
          active: true,
          category: 'cat-1',
          gender: 'unisex',
          images: [],
          variants: [
            { id: 'v1', size: '22', sku: 'A', active: true },
            { id: 'v2', size: '24', sku: 'B', active: true },
            { id: 'v3', size: '26', sku: 'C', active: false },
          ],
        },
      ],
      next: null,
      previous: null,
    } as any);

    renderWithProviders(<UniformCatalogView />);

    expect(await screen.findByText('Sizes: 22, 24')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sizes (3)' }));
    expect(await screen.findByText('Manage Sizes & SKUs')).toBeTruthy();
  });

  it('verifies grep find nothing for localStorage in admin components and portal page', () => {
    const adminModules = import.meta.glob<string>(
      ['../components/admin/**/*.tsx', '../components/admin/**/*.ts', './AdminPortal.tsx'],
      { query: '?raw', import: 'default', eager: true }
    );

    const matches: string[] = [];
    for (const [file, content] of Object.entries(adminModules)) {
      if (typeof content === 'string' && content.includes('localStorage')) {
        matches.push(file);
      }
    }

    expect(matches).toEqual([]);
  });
  it('Save Changes uploads the photo picked while editing an item', async () => {
    mockUser.current = { id: 'boss-123', username: 'test_boss', role: 'BOSS' };
    vi.spyOn(portalApi, 'categories').mockResolvedValue({
      results: [{ id: 'cat-1', name: 'Uniforms', slug: 'uniforms', display_order: 1, active: true }],
      next: null,
      previous: null,
    } as any);
    vi.spyOn(portalApi, 'schools').mockResolvedValue({ results: [], next: null, previous: null } as any);
    const product = {
      id: 'prod-photo',
      name: 'KV Shirt',
      selling_price: '399.00',
      cost_price: '200.00',
      active: true,
      category: 'cat-1',
      school: null,
      gender: 'unisex',
      variants: [],
      images: [],
    };
    vi.spyOn(portalApi, 'products').mockResolvedValue({ results: [product], next: null, previous: null } as any);
    const updateSpy = vi.spyOn(portalApi, 'updateProduct').mockResolvedValue(product as any);
    const photoSpy = vi.spyOn(portalApi, 'uploadProductPhoto').mockResolvedValue({
      ...product,
      images: ['https://school-store.aqualite.workers.dev/media/products/prod-photo/a.webp'],
    } as any);

    renderWithProviders(<UniformCatalogView />);
    fireEvent.click((await screen.findAllByRole('button', { name: /^Edit$/i }))[0]);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const photo = new File(['x'.repeat(20)], 'IMG_2041.HEIC.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [photo] } });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => expect(photoSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy).toHaveBeenCalled();
    const [id, sent] = photoSpy.mock.calls[0];
    expect(id).toBe('prod-photo');
    expect((sent as File).type).toBe('image/jpeg');
    expect(await screen.findByText('Product updated successfully.')).toBeTruthy();
  });

  it('keeps the form open and says why when the photo upload fails', async () => {
    mockUser.current = { id: 'boss-123', username: 'test_boss', role: 'BOSS' };
    vi.spyOn(portalApi, 'categories').mockResolvedValue({
      results: [{ id: 'cat-1', name: 'Uniforms', slug: 'uniforms', display_order: 1, active: true }],
      next: null,
      previous: null,
    } as any);
    vi.spyOn(portalApi, 'schools').mockResolvedValue({ results: [], next: null, previous: null } as any);
    const product = {
      id: 'prod-photo',
      name: 'KV Shirt',
      selling_price: '399.00',
      active: true,
      category: 'cat-1',
      school: null,
      gender: 'unisex',
      variants: [],
      images: [],
    };
    vi.spyOn(portalApi, 'products').mockResolvedValue({ results: [product], next: null, previous: null } as any);
    vi.spyOn(portalApi, 'updateProduct').mockResolvedValue(product as any);
    vi.spyOn(portalApi, 'uploadProductPhoto').mockRejectedValue(new Error('Only JPG, PNG, and WebP images are allowed.'));

    renderWithProviders(<UniformCatalogView />);
    fireEvent.click((await screen.findAllByRole('button', { name: /^Edit$/i }))[0]);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })] } });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    expect(
      await screen.findByText('Item saved, but the photo did not upload: Only JPG, PNG, and WebP images are allowed.')
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /Save Changes/i })).toBeTruthy();
  });
  it('lists every item, not only the first page of 50', async () => {
    mockUser.current = { id: 'boss-123', username: 'test_boss', role: 'BOSS' };
    vi.spyOn(portalApi, 'categories').mockResolvedValue({ results: [], next: null, previous: null } as any);
    vi.spyOn(portalApi, 'schools').mockResolvedValue({ results: [], next: null, previous: null } as any);
    const item = (n: number) => ({
      id: `p-${n}`, name: `Item ${n}`, selling_price: '100.00', active: true,
      category: 'cat-1', gender: 'unisex', variants: [], images: [],
    });
    // Like the real server: cursor pages, and a page number in the query is ignored.
    const spy = vi.spyOn(portalApi, 'products').mockImplementation(async (p: any) =>
      p.cursor !== 'cD01MA'
        ? ({ results: Array.from({ length: 50 }, (_, i) => item(i + 1)), next: 'https://school-store.aqualite.workers.dev/api/products/?cursor=cD01MA&page_size=50', previous: null } as any)
        : ({ results: [item(51), item(52)], next: null, previous: 'https://school-store.aqualite.workers.dev/api/products/?cursor=cj0x' } as any)
    );

    renderWithProviders(<UniformCatalogView />);
    expect((await screen.findAllByText('Item 52')).length).toBeGreaterThan(0);
    expect(spy).toHaveBeenCalledTimes(2);
    // Each item once, not page 1 repeated.
    expect(screen.getAllByText('Item 1').length).toBeLessThanOrEqual(2);
  });
});
