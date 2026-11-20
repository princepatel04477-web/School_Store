// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ParentSignInSheet } from './ParentSignInSheet';
import * as apiModule from '../../api';

let mockCurrentUser: any = { role: 'PARENT', phone: '9876543210' };

vi.mock('../../auth', () => ({
  useAuth: () => ({
    user: mockCurrentUser,
    signInWithOtp: vi.fn(),
  }),
}));

const mockSchools = [
  { id: 'sch-1', name: 'Delhi Public School', code: 'DPS' },
  { id: 'sch-2', name: 'St. Xaviers', code: 'STX' },
];

describe('ParentSignInSheet child loading and error behaviour', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentUser = { role: 'PARENT', phone: '9876543210' };
    vi.spyOn(apiModule.parentChildren, 'schools').mockResolvedValue(mockSchools);
  });

  afterEach(() => {
    cleanup();
  });

  it('immediately sets step to children with loading skeleton when opened for signed-in parent, avoiding phone input flash', async () => {
    // API call remains pending
    vi.spyOn(apiModule.parentChildren, 'list').mockImplementation(() => new Promise(() => {}));

    render(
      <ParentSignInSheet
        open={true}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />
    );

    // Verify loading status is visible
    expect(screen.getByRole('status', { name: /checking/i })).toBeDefined();
    // Does NOT render mobile phone input
    expect(screen.queryByLabelText(/mobile/i)).toBeNull();
  });

  it('routes to find-child flow on successful empty response', async () => {
    vi.spyOn(apiModule.parentChildren, 'list').mockResolvedValue({ results: [] });

    render(
      <ParentSignInSheet
        open={true}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />
    );

    await waitFor(() => {
      // Step transitions to find
      expect(screen.getByLabelText(/gr number/i)).toBeDefined();
      expect(screen.getByLabelText(/child’s date of birth/i)).toBeDefined();
    });
  });

  it('does NOT route to find-child flow on request failure, but shows distinct error and accessible retry action', async () => {
    vi.spyOn(apiModule.parentChildren, 'list').mockRejectedValue(new Error('500 server error'));

    render(
      <ParentSignInSheet
        open={true}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });

    // Error message is displayed
    expect(screen.getByText(/could not load your children\. please try again\./i)).toBeDefined();
    // Accessible retry button is offered
    expect(screen.getByRole('button', { name: /try again/i })).toBeDefined();

    // Crucial requirement: failed request must NOT send user into openFind
    expect(screen.queryByLabelText(/gr number/i)).toBeNull();
    expect(screen.queryByLabelText(/child’s date of birth/i)).toBeNull();
  });

  it('recovers and displays real children when retry is clicked after failure', async () => {
    let fail = true;
    vi.spyOn(apiModule.parentChildren, 'list').mockImplementation(() => {
      if (fail) return Promise.reject(new Error('Outage'));
      return Promise.resolve({
        results: [
          {
            id: 'kid-1',
            name: 'Pooja Patel',
            gr_number: 'GR-100',
            grade_name: '5',
            class_name: '5',
            section: 'A',
            gender: 'Female',
            date_of_birth: '2015-05-10',
            school: 'sch-1',
            school_name: 'Delhi Public School',
            school_code: 'DPS',
            active: true,
          },
        ],
      });
    });

    render(
      <ParentSignInSheet
        open={true}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });

    // Server recovers
    fail = false;

    const retryBtn = screen.getByRole('button', { name: /try again/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText('Pooja Patel')).toBeDefined();
    });

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('allows explicit transition to find-child flow via button action', async () => {
    vi.spyOn(apiModule.parentChildren, 'list').mockRejectedValue(new Error('Server error'));

    render(
      <ParentSignInSheet
        open={true}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });

    // User explicitly decides to find by GR number
    const findInsteadBtn = screen.getByRole('button', { name: /find child with gr number instead/i });
    fireEvent.click(findInsteadBtn);

    await waitFor(() => {
      expect(screen.getByLabelText(/gr number/i)).toBeDefined();
      expect(screen.getByLabelText(/child’s date of birth/i)).toBeDefined();
    });
  });

  it('renders children list and calls onDone with selected child', async () => {
    const mockChild = {
      id: 'kid-22',
      name: 'Rohan Mehta',
      gr_number: 'GR-222',
      grade_name: '8',
      class_name: '8',
      section: 'B',
      gender: 'Male',
      date_of_birth: '2012-08-15',
      school: 'sch-1',
      school_name: 'Delhi Public School',
      school_code: 'DPS',
      active: true,
    };

    vi.spyOn(apiModule.parentChildren, 'list').mockResolvedValue({
      results: [mockChild],
    });

    const onDoneMock = vi.fn();

    render(
      <ParentSignInSheet
        open={true}
        onClose={vi.fn()}
        onDone={onDoneMock}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Rohan Mehta')).toBeDefined();
    });

    const kidBtn = screen.getByRole('button', { name: /Rohan Mehta/i });
    fireEvent.click(kidBtn);

    expect(onDoneMock).toHaveBeenCalledWith(mockChild);
  });

  it('opens directly in find step when initialStep="find"', async () => {
    render(
      <ParentSignInSheet
        open={true}
        initialStep="find"
        onClose={vi.fn()}
        onDone={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/gr number/i)).toBeDefined();
      expect(screen.getByLabelText(/child’s date of birth/i)).toBeDefined();
    });
  });
});
