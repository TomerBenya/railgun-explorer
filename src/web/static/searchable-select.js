(function() {
  class SearchableSelect {
    constructor(container) {
      this.container = container;
      this.hiddenInput = container.querySelector('input[type="hidden"]');
      this.searchInput = container.querySelector('.searchable-select-input');
      this.dropdown = container.querySelector('.searchable-select-dropdown');
      this.options = Array.from(container.querySelectorAll('.searchable-select-option'));
      this.highlightedIndex = -1;
      this.isOpen = false;

      this.init();
    }

    init() {
      // Click on input opens dropdown
      this.searchInput.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggle();
      });

      // Typing filters options
      this.searchInput.addEventListener('input', () => {
        this.filter();
        if (!this.isOpen) this.open();
      });

      // Keyboard navigation
      this.searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (!this.isOpen) this.open();
          this.highlightNext();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.highlightPrev();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (this.highlightedIndex >= 0) {
            const visible = this.getVisibleOptions();
            if (visible[this.highlightedIndex]) {
              this.select(visible[this.highlightedIndex]);
            }
          }
        } else if (e.key === 'Escape') {
          this.close();
        }
      });

      // Click on option selects it
      this.options.forEach(opt => {
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          this.select(opt);
        });
        opt.addEventListener('mouseenter', () => {
          this.clearHighlight();
          opt.classList.add('highlighted');
        });
        opt.addEventListener('mouseleave', () => {
          opt.classList.remove('highlighted');
        });
      });

      // Click outside closes dropdown
      document.addEventListener('click', (e) => {
        if (!this.container.contains(e.target)) {
          this.close();
        }
      });
    }

    getVisibleOptions() {
      return this.options.filter(opt => opt.style.display !== 'none');
    }

    filter() {
      const search = this.searchInput.value.toLowerCase();
      let hasVisible = false;

      this.options.forEach(opt => {
        const text = opt.textContent.toLowerCase();
        const matches = text.includes(search);
        opt.style.display = matches ? '' : 'none';
        if (matches) hasVisible = true;
      });

      // Show/hide no results message
      let noResults = this.dropdown.querySelector('.searchable-select-no-results');
      if (!hasVisible) {
        if (!noResults) {
          noResults = document.createElement('div');
          noResults.className = 'searchable-select-no-results';
          noResults.textContent = 'No tokens found';
          this.dropdown.appendChild(noResults);
        }
        noResults.style.display = '';
      } else if (noResults) {
        noResults.style.display = 'none';
      }

      this.highlightedIndex = -1;
      this.clearHighlight();
    }

    clearHighlight() {
      this.options.forEach(opt => opt.classList.remove('highlighted'));
    }

    highlightNext() {
      const visible = this.getVisibleOptions();
      if (visible.length === 0) return;
      this.clearHighlight();
      this.highlightedIndex = (this.highlightedIndex + 1) % visible.length;
      visible[this.highlightedIndex].classList.add('highlighted');
      visible[this.highlightedIndex].scrollIntoView({ block: 'nearest' });
    }

    highlightPrev() {
      const visible = this.getVisibleOptions();
      if (visible.length === 0) return;
      this.clearHighlight();
      this.highlightedIndex = this.highlightedIndex <= 0 ? visible.length - 1 : this.highlightedIndex - 1;
      visible[this.highlightedIndex].classList.add('highlighted');
      visible[this.highlightedIndex].scrollIntoView({ block: 'nearest' });
    }

    select(option) {
      const value = option.dataset.value;
      const text = option.textContent;

      this.hiddenInput.value = value;
      this.searchInput.value = text;

      // Update selected state
      this.options.forEach(opt => opt.classList.remove('selected'));
      option.classList.add('selected');

      this.close();
    }

    open() {
      this.isOpen = true;
      this.dropdown.classList.add('open');
      this.searchInput.select();
    }

    close() {
      this.isOpen = false;
      this.dropdown.classList.remove('open');
      this.highlightedIndex = -1;
      this.clearHighlight();

      // Reset search to show selected value
      const selected = this.options.find(opt => opt.classList.contains('selected'));
      if (selected) {
        this.searchInput.value = selected.textContent;
      }
      this.filter(); // Reset filter to show all
    }

    toggle() {
      if (this.isOpen) {
        this.close();
      } else {
        this.open();
      }
    }
  }

  // Initialize all searchable selects
  window.initSearchableSelects = function() {
    document.querySelectorAll('.searchable-select').forEach(container => {
      if (!container.dataset.initialized) {
        new SearchableSelect(container);
        container.dataset.initialized = 'true';
      }
    });
  };

  document.addEventListener('DOMContentLoaded', window.initSearchableSelects);
})();
