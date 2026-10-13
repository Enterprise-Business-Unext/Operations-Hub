# Fix schedule_complete Not Recalculated on Batch Update

## Problem
When `training_days` or `end_date` is edited on a batch, the `schedule_complete` flag is not recalculated. This causes it to stay `True` even when scheduled sessions < training_days.

## Root Cause
The `BatchService.update()` method validates that `training_days` >= scheduled sessions count, but doesn't recalculate `schedule_complete` after the update.

## Solution
Add `schedule_complete` recalculation in `BatchService.update()` after setting fields, when:
- `training_days` is changed
- `end_date` is changed (could affect schedule via missing session generation)

The count should include ALL sessions regardless of status (as user confirmed).

## Files to Modify

1. **backend/app/api/v1/batches/service.py**
   - In `update()` method, after applying changes (around line 665-668)
   - Recalculate `schedule_complete` using `batch_repo.get_scheduled_session_counts()`

## Implementation Details

```python
# After line 665-668 where fields are set:
for field, value in update_data.items():
    setattr(batch, field, value)

batch.updated_at = datetime.now(timezone.utc)

# Recalculate schedule_complete if training_days or end_date changed
if "training_days" in update_data or "end_date" in update_data:
    scheduled_count = self.batch_repo.get_scheduled_session_counts([batch.id]).get(batch.id, 0)
    batch.schedule_complete = (scheduled_count >= (batch.training_days or 0))

if should_trigger_reapproval:
    ...
```

## Validation
- Create batch with training_days=11
- Apply schedule with 10 sessions → schedule_complete = False
- Edit batch to training_days=10 → schedule_complete = True
- Edit batch to training_days=12 → schedule_complete = False
- Edit end_date to extend range → schedule_complete recalculated

## Tests to Add
- Test schedule_complete recalculates on training_days change
- Test schedule_complete recalculates on end_date change
- Test schedule_complete doesn't change when unrelated fields updated