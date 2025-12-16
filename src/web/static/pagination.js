(function() {
  class TablePaginator {
    constructor(tableId, defaultLimit = 20) {
      this.tableId = tableId;
      this.table = document.getElementById(tableId);
      this.pagination = document.getElementById(tableId + '-pagination');
      if (!this.table || !this.pagination) return;

      this.tbody = this.table.querySelector('tbody');
      this.rows = Array.from(this.tbody.querySelectorAll('tr[data-row]'));
      this.totalItems = this.rows.length;
      this.currentPage = 1;
      this.limit = parseInt(this.pagination.dataset.limit) || defaultLimit;

      this.setupControls();
      this.render();
    }

    get totalPages() {
      return Math.ceil(this.totalItems / this.limit);
    }

    setupControls() {
      this.pagination.querySelector('[data-action="first"]').onclick = () => this.goTo(1);
      this.pagination.querySelector('[data-action="prev"]').onclick = () => this.goTo(this.currentPage - 1);
      this.pagination.querySelector('[data-action="next"]').onclick = () => this.goTo(this.currentPage + 1);
      this.pagination.querySelector('[data-action="last"]').onclick = () => this.goTo(this.totalPages);
      this.pagination.querySelector('[data-action="limit"]').onchange = (e) => {
        this.limit = parseInt(e.target.value);
        this.currentPage = 1;
        this.render();
      };
    }

    goTo(page) {
      this.currentPage = Math.max(1, Math.min(page, this.totalPages));
      this.render();
    }

    render() {
      const start = (this.currentPage - 1) * this.limit;
      const end = start + this.limit;

      // Show/hide rows
      this.rows.forEach((row, i) => {
        row.style.display = (i >= start && i < end) ? '' : 'none';
      });

      // Update info
      const info = this.pagination.querySelector('.pagination-info');
      const startItem = this.totalItems > 0 ? start + 1 : 0;
      const endItem = Math.min(end, this.totalItems);
      info.textContent = 'Showing ' + startItem + '–' + endItem + ' of ' + this.totalItems;

      // Update buttons
      const firstBtn = this.pagination.querySelector('[data-action="first"]');
      const prevBtn = this.pagination.querySelector('[data-action="prev"]');
      const nextBtn = this.pagination.querySelector('[data-action="next"]');
      const lastBtn = this.pagination.querySelector('[data-action="last"]');

      firstBtn.disabled = this.currentPage <= 1;
      prevBtn.disabled = this.currentPage <= 1;
      nextBtn.disabled = this.currentPage >= this.totalPages;
      lastBtn.disabled = this.currentPage >= this.totalPages;

      firstBtn.classList.toggle('disabled', this.currentPage <= 1);
      prevBtn.classList.toggle('disabled', this.currentPage <= 1);
      nextBtn.classList.toggle('disabled', this.currentPage >= this.totalPages);
      lastBtn.classList.toggle('disabled', this.currentPage >= this.totalPages);

      // Update page numbers
      this.renderPageNumbers();

      // Hide pagination if only one page
      this.pagination.style.display = this.totalPages <= 1 ? 'none' : '';
    }

    renderPageNumbers() {
      const container = this.pagination.querySelector('.pagination-pages');
      container.innerHTML = '';

      const pages = [];
      for (let i = 1; i <= this.totalPages; i++) {
        if (i === 1 || i === this.totalPages || (i >= this.currentPage - 2 && i <= this.currentPage + 2)) {
          pages.push(i);
        } else if (pages[pages.length - 1] !== '...') {
          pages.push('...');
        }
      }

      pages.forEach(p => {
        if (p === '...') {
          const span = document.createElement('span');
          span.className = 'pagination-ellipsis';
          span.textContent = '…';
          container.appendChild(span);
        } else {
          const btn = document.createElement('button');
          btn.className = 'pagination-btn' + (p === this.currentPage ? ' current' : '');
          btn.textContent = p;
          btn.onclick = () => this.goTo(p);
          container.appendChild(btn);
        }
      });
    }
  }

  // Initialize all paginators when DOM is ready
  window.initPaginator = function(tableId, limit) {
    new TablePaginator(tableId, limit);
  };
})();
