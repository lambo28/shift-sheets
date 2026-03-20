# Quick Start: Next Optimization Steps

## Checklist for Priority 1: CSS Optimization

### Overview
Extract 93 lines of driver-page-specific CSS from `static/css/style.css` (lines 821-913) to `static/css/pages/drivers.css`

### Steps
- [ ] Read lines 821-913 from `static/css/style.css`
- [ ] Copy the driver-specific CSS rules
- [ ] Append to `static/css/pages/drivers.css`
- [ ] Remove lines 821-913 from `static/css/style.css`
- [ ] Run test suite: `python -m pytest -q`
- [ ] Verify in browser at `/drivers` page
- [ ] Update this document

### Expected Result
- `style.css` reduced from 913 to ~820 lines
- All styles still applied correctly
- 123 tests passing

---

## Checklist for Priority 2: Component Partials

### Overview
Extract repeated component patterns (cards, tables, forms) into reusable partials

### Potential Components to Extract
- [ ] Card component (used in multiple templates)
- [ ] Table wrapper component (shifts/drivers/extra-cars)
- [ ] Modal footer component (repeated button groups)
- [ ] Form field component (repeated input patterns)

### Key Files to Scan
- `templates/index.html` (209 lines)
- `templates/print_daily_sheet.html` (192 lines)
- `templates/shifts.html` (324 lines)
- `templates/drivers.html` (295 lines)

### Steps
1. Identify repeated patterns in templates
2. Create partials in `templates/partials/components/`
3. Update templates to use partials
4. Run test suite
5. Verify in browser

---

## Checklist for Priority 3: JS File Splitting

### Task 3A: Split `scheduling.core.js` (1438 lines)

#### Files to Create
- [ ] `static/js/scheduling.calendar.js` - Calendar rendering
- [ ] `static/js/scheduling.timeoff.js` - Holiday/closure logic
- [ ] `static/js/scheduling.dates.js` - Date utilities

#### Steps
1. Read `scheduling.core.js` and identify function groups
2. Create new files with function subsets
3. Update imports/exports
4. Update `scripts/build_js_bundles.py` if creating new bundle
5. Run: `python scripts/build_js_bundles.py`
6. Run tests: `python -m pytest -q`

### Task 3B: Split `drivers.custom-timings.js` (1014 lines)

#### Files to Create
- [ ] `static/js/drivers.timing-display.js` - UI rendering
- [ ] `static/js/drivers.timing-calc.js` - Business logic
- [ ] `static/js/drivers.timing-events.js` - Event handlers

#### Steps
1. Read `drivers.custom-timings.js` and identify function groups
2. Create new files with function subsets
3. Update imports/exports
4. Update bundle configuration if needed
5. Rebuild and test

---

## Checklist for Priority 4: Backend Validation

### Overview
Create centralized Python validation module to reduce repeated patterns in routes

### Files to Create
- [ ] `utils/validators.py` - Validation helper functions

### Validators to Implement
- [ ] `validate_date(date_str)` - Check date format (YYYY-MM-DD)
- [ ] `validate_time(time_str)` - Check time format (HH:MM)
- [ ] `validate_required(*fields)` - Check required fields
- [ ] `validate_driver_exists(driver_id)` - Check driver in DB
- [ ] `validate_pattern_exists(pattern_id)` - Check pattern in DB
- [ ] `validate_shift_type_exists(shift_id)` - Check shift type in DB

### Step
1. Create `utils/validators.py`
2. Implement each validator function
3. Search routes for `json_error` calls (found 15 instances)
4. Replace with new validator functions
5. Run test suite
6. Update routes: scheduling.py, custom_timings.py, extra_cars.py, shifts.py

---

## Testing After Each Change

### Required Commands
```bash
# Option 1: Run all tests
python -m pytest -q

# Option 2: Run specific test file
python -m pytest tests/test_drivers.py -v

# Option 3: Run with coverage
python -m pytest --cov
```

### Build Commands
```bash
# Rebuild JS bundles (required after any JS change)
python scripts/build_js_bundles.py
```

### Success Criteria
- All 123 tests pass
- No bundle build errors
- Features work correctly in browser
- No console errors in browser DevTools

---

## Common Patterns to Look For

### When Splitting JS Files
```javascript
// Pattern 1: Look for function groups
// ===== Calendar Functions =====
function initCalendar() { ... }
function updateCalendar() { ... }

// Pattern 2: Look for related utilities
// ===== Time Off Utilities =====
function isOnTimeOff() { ... }
function addTimeOff() { ... }
```

### When Extracting Partials
```html
<!-- Look for repeated structures -->
<div class="card">
  <div class="card-header">...</div>
  <div class="card-body">...</div>
</div>

<!-- Extract as partial: templates/partials/components/card.html -->
<!-- Then use: {% include "partials/components/card.html" %} -->
```

### When Creating Validators
```python
# Pattern in routes (find these):
if not request.form.get('name'):
    return json_error('Name is required')

# Refactor to:
error = validate_required(request.form.get('name'), field_name='name')
if error:
    return json_error(error)
```

---

## Notes for Future Work

### Important: Always Update Tests
After refactoring, run the full test suite:
```bash
python -m pytest -q
```

### Browser Verification Checklist
- [ ] Page loads without errors
- [ ] No console warnings/errors
- [ ] Forms submit correctly
- [ ] Modals open/close properly
- [ ] All UI interactions work

### Documentation
- Update `OPTIMIZATION_PROGRESS.md` with completed work
- Add comments to new functions in split JS files
- Document any new validation patterns

### Bundle Management
- Run `python scripts/build_js_bundles.py` after ANY JS file change
- Check `static/js/bundles/manifest.json` for updated hashes
- Verify bundles load in browser (check Network tab in DevTools)

---

## Quick Reference: Current State

### Form Submission Pattern (Already Optimized)
```javascript
// Use this pattern for NEW form handlers:
submitForm({
  form: document.getElementById('myForm'),
  validateFn: (formData) => {
    // custom validation
    return error ? 'Error message' : null;
  },
  onSuccess: (data) => {
    // refresh page or update UI
  },
  hideModal: 'myModalId',
  resetForm: true
});
```

### Validation Pattern (Already Optimized)
```javascript
// Use existing validators:
if (error = Validate.required(value)) return error;
if (error = Validate.date_string(value)) return error;
if (error = Validate.time_string(value)) return error;
```

### Test Command
```bash
cd /home/lambertnet/projects/shift-sheets
python -m pytest -q
```

### Bundle Build Command
```bash
cd /home/lambertnet/projects/shift-sheets
python scripts/build_js_bundles.py
```

---

## Contact / Questions

If stuck on any optimization:
1. Check `OPTIMIZATION_PROGRESS.md` for detailed context
2. Review the phase that's most similar to current work
3. Look at existing code patterns in the codebase
4. Run tests frequently to validate changes
