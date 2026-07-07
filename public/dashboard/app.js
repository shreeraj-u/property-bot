const VIEWS = ['overview', 'rent', 'documents', 'complaints', 'tenants'];

const sgd = new Intl.NumberFormat('en-SG', {
  style: 'currency',
  currency: 'SGD',
  maximumFractionDigits: 0,
});

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function shiftMonth(month, offset) {
  const [year, mon] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, mon - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
}

function dashboard() {
  return {
    view: 'overview',
    month: currentMonth(),
    loading: false,
    toasts: [],

    stats: null,
    trendChart: null,

    rent: null,
    rentMode: 'grid',
    rentStatusFilter: 'all',
    rentBlockFilter: 'all',
    rentSearch: '',

    docTab: 'proofs',
    proofs: null,
    proofStatus: 'pending',
    proofMonth: '',
    proofZoom: null,
    leases: null,

    complaints: null,

    tenants: null,
    tenantSearch: '',
    vacantUnits: null,

    drawer: { open: false, loading: false, tenant: null },

    // ---- lifecycle ----

    init() {
      const [path, query] = window.location.hash.replace(/^#\/?/, '').split('?');
      if (VIEWS.includes(path)) this.view = path;

      const month = new URLSearchParams(query || '').get('month');
      if (/^\d{4}-\d{2}$/.test(month || '')) this.month = month;

      window.addEventListener('hashchange', () => {
        const next = window.location.hash.replace(/^#\/?/, '').split('?')[0];
        if (VIEWS.includes(next) && next !== this.view) this.go(next);
      });

      this.loadView();
    },

    go(view) {
      this.view = view;
      window.location.hash = `/${view}`;
      this.loadView();
    },

    async loadView() {
      if (this.view === 'overview') await this.loadOverview();
      if (this.view === 'rent') await this.loadRent();
      if (this.view === 'documents') await Promise.all([this.loadProofs(), this.loadLeases()]);
      if (this.view === 'complaints') await this.loadComplaints();
      if (this.view === 'tenants') await this.loadTenants();
    },

    // ---- api ----

    async api(path, options = {}) {
      const res = await fetch(`/api/dashboard${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
      });

      if (res.status === 401) {
        window.location.href = '/dashboard/login';
        throw new Error('Not authenticated');
      }

      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      return body.data;
    },

    async logout() {
      await fetch('/dashboard/logout', { method: 'POST' });
      window.location.href = '/dashboard/login';
    },

    toast(message, isError = false) {
      const id = Date.now() + Math.random();
      this.toasts.push({ id, message, isError });
      setTimeout(() => {
        this.toasts = this.toasts.filter((t) => t.id !== id);
      }, 3500);
    },

    async run(work, successMessage) {
      try {
        await work();
        if (successMessage) this.toast(successMessage);
      } catch (error) {
        this.toast(error.message, true);
      }
    },

    // ---- loaders ----

    async loadOverview() {
      await this.run(async () => {
        this.stats = await this.api(`/overview?month=${this.month}`);
        this.$nextTick(() => this.renderTrend());
      });
    },

    async loadRent() {
      await this.run(async () => {
        this.rent = await this.api(`/rent?month=${this.month}`);
      });
    },

    async loadProofs() {
      await this.run(async () => {
        const month = this.proofMonth ? `&month=${this.proofMonth}` : '';
        this.proofs = await this.api(`/proofs?status=${this.proofStatus}${month}`);
      });
    },

    async loadLeases() {
      await this.run(async () => {
        this.leases = await this.api('/leases');
      });
    },

    async loadComplaints() {
      await this.run(async () => {
        this.complaints = await this.api('/complaints');
      });
    },

    async loadTenants() {
      await this.run(async () => {
        const [tenants, vacant, leases] = await Promise.all([
          this.api('/tenants'),
          this.api('/vacant-units'),
          this.leases ? Promise.resolve(this.leases) : this.api('/leases'),
        ]);
        this.tenants = tenants;
        this.vacantUnits = vacant;
        this.leases = leases;
      });
    },

    // ---- month navigation ----

    changeMonth(offset) {
      this.month = shiftMonth(this.month, offset);
      if (this.view === 'overview') this.loadOverview();
      if (this.view === 'rent') this.loadRent();
    },

    // ---- deep links from overview ----

    goRentOverdue() {
      this.rentMode = 'list';
      this.rentStatusFilter = 'overdue';
      this.go('rent');
    },

    goPendingProofs() {
      this.docTab = 'proofs';
      this.proofStatus = 'pending';
      this.go('documents');
    },

    // ---- chart ----

    renderTrend() {
      const canvas = this.$refs.trend;
      if (!canvas || typeof Chart === 'undefined' || !this.stats) return;

      if (this.trendChart) this.trendChart.destroy();

      const trend = this.stats.trend || [];
      this.trendChart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: trend.map((t) => this.monthLabel(t.month)),
          datasets: [
            {
              label: 'Due',
              data: trend.map((t) => t.expected),
              backgroundColor: '#e3e6e0',
              borderRadius: 5,
            },
            {
              label: 'Collected',
              data: trend.map((t) => t.collected),
              backgroundColor: '#1a7f5a',
              borderRadius: 5,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } },
          scales: {
            y: { ticks: { callback: (v) => `$${v / 1000}k` }, grid: { color: '#f0f1ee' } },
            x: { grid: { display: false } },
          },
        },
      });
    },

    // ---- rent board ----

    unitTone(unit) {
      if (unit.status === 'vacant') return 'vacant';
      return unit.payment?.status || 'none';
    },

    unitToneLabel(unit) {
      if (unit.status === 'vacant') return 'vacant';
      return unit.payment?.status || 'no record';
    },

    get rentBlocks() {
      const blocks = new Map();
      for (const unit of this.rent?.units || []) {
        const block = unit.block || '—';
        if (!blocks.has(block)) blocks.set(block, new Map());
        const floors = blocks.get(block);
        if (!floors.has(unit.floor)) floors.set(unit.floor, []);
        floors.get(unit.floor).push(unit);
      }

      return [...blocks.keys()].sort().map((name) => ({
        name,
        floors: [...blocks.get(name).keys()]
          .sort((a, b) => b - a)
          .map((floor) => ({
            floor,
            units: blocks
              .get(name)
              .get(floor)
              .sort((a, b) => a.unit_number.localeCompare(b.unit_number)),
          })),
      }));
    },

    get rentRows() {
      const search = this.rentSearch.trim().toLowerCase();
      return (this.rent?.units || []).filter((unit) => {
        if (this.rentBlockFilter !== 'all' && unit.block !== this.rentBlockFilter) return false;
        if (this.rentStatusFilter !== 'all' && this.unitTone(unit) !== this.rentStatusFilter) {
          return false;
        }
        if (!search) return true;
        return (
          unit.unit_number.toLowerCase().includes(search) ||
          (unit.tenant?.full_name || '').toLowerCase().includes(search)
        );
      });
    },

    get rentCounts() {
      const counts = { paid: 0, pending: 0, overdue: 0, vacant: 0 };
      for (const unit of this.rent?.units || []) {
        const tone = this.unitTone(unit);
        if (counts[tone] != null) counts[tone] += 1;
      }
      return counts;
    },

    // ---- proofs ----

    setProofStatus(status) {
      this.proofStatus = status;
      this.loadProofs();
    },

    async approveProof(proof) {
      await this.run(async () => {
        await this.api(`/proofs/${proof.short_id}/approve`, { method: 'POST' });
        await this.loadProofs();
      }, `Approved — ${proof.tenants?.full_name}'s rent marked paid, tenant notified.`);
    },

    async rejectProof(proof) {
      const reason = window.prompt(
        `Reject ${proof.tenants?.full_name}'s proof — reason sent to tenant:`,
        'Please resubmit with a clearer screenshot.'
      );
      if (reason === null) return;

      await this.run(async () => {
        await this.api(`/proofs/${proof.short_id}/reject`, {
          method: 'POST',
          body: JSON.stringify({ reason }),
        });
        await this.loadProofs();
      }, 'Rejected — tenant notified via WhatsApp.');
    },

    async openLeaseDoc(leaseId) {
      await this.run(async () => {
        const { url } = await this.api(`/leases/${leaseId}/document`);
        window.open(url, '_blank', 'noopener');
      });
    },

    // ---- complaints ----

    complaintsBy(status) {
      return (this.complaints || []).filter((c) => c.status === status);
    },

    async setComplaintStatus(complaint, status) {
      await this.run(async () => {
        await this.api(`/complaints/${complaint.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status }),
        });
        await this.loadComplaints();
      }, status === 'resolved' ? 'Complaint resolved.' : 'Complaint updated.');
    },

    // ---- tenants ----

    get filteredTenants() {
      const search = this.tenantSearch.trim().toLowerCase();
      if (!search) return this.tenants || [];
      return (this.tenants || []).filter(
        (t) =>
          t.full_name.toLowerCase().includes(search) ||
          (t.units?.unit_number || '').toLowerCase().includes(search) ||
          (t.phone_number || '').includes(search)
      );
    },

    get leaseTimeline() {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      return (this.leases || [])
        .filter((l) => l.status === 'active')
        .map((lease) => {
          const daysLeft = Math.ceil((new Date(lease.end_date) - today) / 86400000);
          return { ...lease, days_left: daysLeft };
        })
        .filter((l) => l.days_left >= 0)
        .sort((a, b) => a.days_left - b.days_left)
        .slice(0, 27);
    },

    timelineWidth(lease) {
      return `${Math.max(3, Math.min(100, (lease.days_left / 365) * 100))}%`;
    },

    timelineColor(lease) {
      if (lease.days_left <= 60) return 'var(--overdue)';
      if (lease.days_left <= 120) return 'var(--pending)';
      return 'var(--paid)';
    },

    // ---- tenant drawer ----

    async openTenant(tenantId) {
      if (!tenantId) return;
      this.drawer = { open: true, loading: true, tenant: null };
      try {
        this.drawer.tenant = await this.api(`/tenants/${tenantId}`);
      } catch (error) {
        this.toast(error.message, true);
        this.drawer.open = false;
      } finally {
        this.drawer.loading = false;
      }
    },

    closeDrawer() {
      this.drawer.open = false;
    },

    waLink(phone) {
      return `https://wa.me/${String(phone || '').replace(/\D/g, '')}`;
    },

    // ---- formatting ----

    money(value) {
      if (value == null) return '—';
      return sgd.format(Number(value));
    },

    monthLabel(month) {
      if (!month) return '—';
      const [year, mon] = month.split('-').map(Number);
      return new Date(Date.UTC(year, mon - 1, 15)).toLocaleDateString('en-SG', {
        month: 'short',
        year: 'numeric',
      });
    },

    date(value) {
      if (!value) return '—';
      return new Date(value).toLocaleDateString('en-SG', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    },

    ageLabel(value) {
      const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
      if (days <= 0) return 'today';
      if (days === 1) return '1 day old';
      return `${days} days old`;
    },

    pct(part, whole) {
      if (!whole) return 0;
      return Math.round((part / whole) * 100);
    },
  };
}

window.dashboard = dashboard;
