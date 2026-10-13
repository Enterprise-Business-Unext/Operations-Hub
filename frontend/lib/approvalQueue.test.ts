import { approvalReapprovalLabel } from '@/lib/approvalQueue';
import type { Batch } from '@/lib/api';

const baseBatch = {
  id: 'batch-id',
  batch_id: 'BATCH-001',
  program_name: 'Python Training',
  category: 'Technical',
  residential_type: 'Non-Residential',
  delivery_mode: 'Online',
  training_days: 2,
  total_hours: 16,
  total_enrollments: 20,
  status: 'Approval 1 Pending',
  is_schema_locked: false,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
} as Batch;

describe('approvalReapprovalLabel', () => {
  it('labels a first-time submission', () => {
    expect(approvalReapprovalLabel(baseBatch)).toBe('First submission');
  });

  it('labels a reapproval with its count', () => {
    expect(approvalReapprovalLabel({ ...baseBatch, is_reapproval: true, reapproval_count: 1 })).toBe('Reapproval #1');
    expect(approvalReapprovalLabel({ ...baseBatch, is_reapproval: true, reapproval_count: 7 })).toBe('Reapproval #7');
  });

  it('falls back to #1 when the count is missing', () => {
    expect(approvalReapprovalLabel({ ...baseBatch, is_reapproval: true })).toBe('Reapproval #1');
    expect(approvalReapprovalLabel({ ...baseBatch, is_reapproval: true, reapproval_count: undefined })).toBe('Reapproval #1');
  });

  it('ignores a stale count when the flag is false', () => {
    expect(approvalReapprovalLabel({ ...baseBatch, is_reapproval: false, reapproval_count: 3 })).toBe('First submission');
    expect(approvalReapprovalLabel({ ...baseBatch, reapproval_count: 3 })).toBe('First submission');
  });
});
