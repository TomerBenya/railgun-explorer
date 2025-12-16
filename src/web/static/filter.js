document.addEventListener('DOMContentLoaded', function() {
  const timePresetSelect = document.getElementById('timePreset');
  const customDates = document.getElementById('custom-dates');
  if (timePresetSelect && customDates) {
    // Set initial state based on current selection
    customDates.style.display = timePresetSelect.value === 'custom' ? 'flex' : 'none';
    // Listen for changes
    timePresetSelect.addEventListener('change', function() {
      customDates.style.display = this.value === 'custom' ? 'flex' : 'none';
    });
  }
});
