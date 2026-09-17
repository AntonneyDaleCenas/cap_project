import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { InspectionRecord } from '../models/dashboard.model';
import { InspectionDataService } from '../services/inspection-data.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly inspectionCacheKey = 'tax-inspection-dashboard-cache';
  searchControl = new FormControl('', { nonNullable: true });
  userSearchControl = new FormControl('', { nonNullable: true });
  activeView: 'home' | 'new-inspection' | 'inspections' | 'analytics' | 'users' | 'settings' = 'home';
  showProfile = false;
  selectedStatus: 'All' | 'Completed' | 'Pending' | 'Flagged' = 'All';
  selectedPayment: 'All' | 'Paid' | 'Unpaid' = 'All';
  selectedSort: 'date-desc' | 'date-asc' | 'name-asc' = 'date-desc';
  selectedInspector: string | 'All' = 'All';
  inspectorFilterOpen = true;
  reportOptionsOpen = false;
  settingsNotice = '';

  constructor(private router: Router, private fb: FormBuilder, private inspectionData: InspectionDataService) {}

  inspectionForm!: FormGroup;
  isSubmittingInspection = false;
  readonly truckTypes = ['6 Wheelers', '10 Wheelers'];
  readonly quantityOptions = Array.from({ length: 11 }, (_, index) => `${10 + index} cubic meters`);
  penaltyRate = 75;
  penaltyRateControl = new FormControl(75, { nonNullable: true, validators: [Validators.required, Validators.min(1)] });

  inspections: InspectionRecord[] = [];

  filteredInspections: InspectionRecord[] = [];
  selectedInspection: InspectionRecord | null = null;
  loading = false;
  loadError = false;
  private refreshTimer?: ReturnType<typeof setInterval>;
  private userRefreshTimer?: ReturnType<typeof setInterval>;
  selectedUserStatus = 'All';
  chartMode: 'daily' | 'monthly' = 'daily';
  users: Array<{ name: string; email: string; role: string; department: string; joined: string; lastActive: string; inspections: number; status: string }> = [];

  get completedCount(): number {
    return this.inspections.filter((record) => this.getEffectiveStatus(record) === 'Completed').length;
  }

  get pendingCount(): number {
    return this.inspections.filter((record) => this.getEffectiveStatus(record) === 'Pending').length;
  }

  get collectedAmount(): number {
    return this.inspections
      .filter((record) => record.paymentStatus === 'Paid')
      .reduce((total, record) => total + (record.amount ?? 0), 0);
  }

  get flaggedCount(): number {
    return this.inspections.filter((record) => this.getEffectiveStatus(record) === 'Flagged').length;
  }

  get filteredUsers() {
    const term = this.userSearchControl.value.trim().toLowerCase();
    return this.users.filter((user) =>
      (this.selectedUserStatus === 'All' || user.status === this.selectedUserStatus) &&
      (!term || `${user.name} ${user.email} ${user.department}`.toLowerCase().includes(term))
    );
  }

  get activeUserCount(): number { return this.users.filter((user) => user.status === 'Active').length; }
  get inactiveUserCount(): number { return this.users.filter((user) => user.status === 'Inactive').length; }

  ngOnInit(): void {
    this.inspectionForm = this.fb.group({
      haulerName: ['', Validators.required],
      truckPlate: ['', [Validators.required, Validators.maxLength(20)]],
      time: ['', Validators.required],
      truckType: ['6 Wheelers', Validators.required],
      address: ['', Validators.required],
      sourceOfMaterial: ['', Validators.required],
      kindOfMaterial: ['Sand', Validators.required],
      quantity: ['10 cubic meters', Validators.required],
      placeOfDelivery: ['', Validators.required],
      deliveryReceipt: ['', Validators.required]
    });
    this.loadPenaltyRate();
    this.restoreCachedInspections();
    this.loadInspections();
    this.refreshTimer = setInterval(() => this.loadInspections(), 1000);
    this.loadUsers();
    this.userRefreshTimer = setInterval(() => this.loadUsers(), 1000);

    this.searchControl.valueChanges.subscribe(() => {
      this.applyFilters();
    });
  }

  get selectedQuantity(): number {
    return Number.parseInt(String(this.inspectionForm?.get('quantity')?.value ?? '0'), 10) || 0;
  }

  get allowedVolume(): number {
    return this.inspectionForm?.get('truckType')?.value === '10 Wheelers' ? 15 : 10;
  }

  get excessVolume(): number { return Math.max(this.selectedQuantity - this.allowedVolume, 0); }
  get penaltyAmount(): number { return this.excessVolume * this.penaltyRate; }

  async loadPenaltyRate(): Promise<void> {
    try {
      this.penaltyRate = await this.inspectionData.getPenaltyRate();
      this.penaltyRateControl.setValue(this.penaltyRate, { emitEvent: false });
    } catch (error) {
      console.error('Could not load penalty rate:', error);
    }
  }

  async savePenaltyRate(): Promise<void> {
    const nextRate = Number(this.penaltyRateControl.value);
    if (!Number.isFinite(nextRate) || nextRate <= 0) {
      this.penaltyRateControl.setErrors({ invalidRate: true });
      return;
    }

    try {
      await this.inspectionData.updatePenaltyRate(nextRate);
      this.penaltyRate = nextRate;
      alert('Penalty rate updated for all new inspections.');
    } catch (error) {
      console.error('Could not save penalty rate:', error);
      alert('The penalty rate could not be saved. Verify the Supabase settings table and permissions.');
    }
  }

  submitAdminInspection(): void {
    if (this.inspectionForm.invalid) {
      this.inspectionForm.markAllAsTouched();
      return;
    }

    const value = this.inspectionForm.value;
    const payload = {
      hauler_name: value.haulerName,
      truck_plate: value.truckPlate,
      time: value.time,
      truck_type: value.truckType,
      address: value.address,
      source_of_material: value.sourceOfMaterial,
      kind_of_material: value.kindOfMaterial,
      quantity: value.quantity,
      place_of_delivery: value.placeOfDelivery,
      delivery_receipt: value.deliveryReceipt,
      quantity_cubic_meters: this.selectedQuantity,
      allowed_volume: this.allowedVolume,
      excess_volume: this.excessVolume,
      penalty_rate: this.penaltyRate,
      penalty_amount: this.penaltyAmount,
      inspector: 'Admin User'
    };

    this.isSubmittingInspection = true;
    this.inspectionData.createInspection(payload).then(() => {
      this.isSubmittingInspection = false;
      this.inspectionForm.reset({ truckType: '6 Wheelers', kindOfMaterial: 'Sand', quantity: '10 cubic meters' });
      alert('The inspection was submitted.');
      this.loadInspections();
    }).catch((error: unknown) => {
      this.isSubmittingInspection = false;
      const message = error instanceof Error ? error.message : 'The inspection could not be submitted.';
      alert(message);
    });
  }

  resetAdminInspection(): void {
    this.inspectionForm.reset({ truckType: '6 Wheelers', kindOfMaterial: 'Sand', quantity: '10 cubic meters' });
  }

  async deleteSelectedInspection(record: InspectionRecord): Promise<void> {
    if (!confirm(`Delete inspection ${record.id} for ${record.businessName}? This cannot be undone.`)) {
      return;
    }

    try {
      await this.inspectionData.deleteInspection(record.databaseInspectionId ?? record.id);
      this.inspections = this.inspections.filter((item) => item.id !== record.id);
      this.selectedInspection = null;
      this.applyFilters();
      localStorage.setItem(this.inspectionCacheKey, JSON.stringify(this.inspections));
      alert('Inspection deleted successfully.');
    } catch (error) {
      console.error('Failed to delete inspection:', error);
      alert(error instanceof Error ? error.message : 'The inspection could not be deleted.');
    }
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    if (this.userRefreshTimer) {
      clearInterval(this.userRefreshTimer);
    }
  }

  async loadUsers(): Promise<void> {
    try {
      const records = await this.inspectionData.listUsers();
      this.users = records.map((user) => {
        const createdAt = this.stringValue(user['created_at'], new Date().toISOString());
        const role = user['role'] === 'admin' ? 'Administrator' : 'Field Officer';
        const status = user['status'] === 'inactive' ? 'Inactive' : 'Active';
        return {
          name: this.stringValue(user['name'], 'Unnamed user'),
          email: this.stringValue(user['email'], ''),
          role,
          department: role === 'Administrator' ? 'Tax Compliance Division' : 'Field Operations',
          joined: createdAt.slice(0, 10),
          lastActive: createdAt.slice(0, 10),
          inspections: 0,
          status
        };
      });
    } catch (error) {
      console.error('Failed to load users from Supabase:', error);
    }
  }

  async loadInspections(): Promise<void> {
    if (this.loading) {
      return;
    }

    this.loading = true;
    this.loadError = false;

    try {
      const records = await this.inspectionData.listInspections();
      this.inspections = records.map((item, index) => this.toInspectionRecord(item, index));
      this.applyFilters();
      localStorage.setItem(this.inspectionCacheKey, JSON.stringify(this.inspections));
    } catch (error) {
      console.error('Failed to load inspections from Supabase:', error);
      this.loadError = true;
    } finally {
      this.loading = false;
    }
  }

  private restoreCachedInspections(): void {
    try {
      const cached = localStorage.getItem(this.inspectionCacheKey);
      if (!cached) {
        return;
      }

      this.inspections = JSON.parse(cached) as InspectionRecord[];
      this.applyFilters();
    } catch (error) {
      console.warn('Could not restore cached inspection records:', error);
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private toInspectionRecord(value: unknown, index: number): InspectionRecord {
    const item = this.isRecord(value) ? value : {};
    const paymentStatus = (item['paymentStatus'] ?? item['payment_status']) === 'Paid' ? 'Paid' : 'Unpaid';
    const statusValue = item['status'] ?? item['assessment_status'];
    const status = statusValue === 'Flagged' ? 'Flagged' : paymentStatus === 'Paid' ? 'Completed' : 'Pending';
    const penaltyAmountValue = item['penaltyAmount'] ?? item['penalty_amount'] ?? item['computed_tax'];
    const penaltyAmount = typeof penaltyAmountValue === 'number'
      ? penaltyAmountValue
      : typeof item['amount'] === 'number' ? item['amount'] : null;

    const databaseInspectionId = this.parseDatabaseId(item['inspection_id'] ?? item['id']) ?? index + 1;

    return {
      id: this.stringValue(item['id'] ?? item['inspection_id'], `INS-${index + 1}`),
      databaseInspectionId,
      businessName: this.stringValue(item['businessName'] ?? item['haulerName'] ?? item['hauler_name'], 'Unnamed hauler'),
      address: this.stringValue(item['address'], 'No address provided'),
      type: this.stringValue(item['type'] ?? item['truckType'] ?? item['truck_type'], 'Unspecified').replace(' WHEELERS', ' Wheelers'),
      status,
      paymentStatus,
      date: this.stringValue(item['date'] ?? item['inspection_date'] ?? item['created_at'], new Date().toISOString().slice(0, 10)),
      amount: penaltyAmount,
      inspector: this.stringValue(item['inspector'], 'Unassigned'),
      note: this.stringValue(item['note'] ?? item['remarks'] ?? item['kindOfMaterial'] ?? item['kind_of_material'], 'No inspection notes provided.'),
      receiptNumber: this.stringValue(item['receiptNumber'] ?? item['receipt_number'], ''),
      cashierNumber: this.stringValue(item['cashierNumber'] ?? item['cashier_number'], ''),
      quantityCubicMeters: this.numberValue(item['quantityCubicMeters'] ?? item['quantity_cubic_meters'] ?? item['actual_volume']),
      allowedVolume: this.numberValue(item['allowedVolume'] ?? item['allowed_volume']),
      excessVolume: this.numberValue(item['excessVolume'] ?? item['excess_volume']),
      penaltyRate: this.numberValue(item['penaltyRate'] ?? item['penalty_rate']),
      penaltyAmount: penaltyAmount ?? undefined,
      createdAt: this.stringValue(item['createdAt'] ?? item['created_at'], '') || undefined
    };
  }

  private numberValue(value: unknown): number | undefined {
    return typeof value === 'number' ? value : undefined;
  }

  private parseDatabaseId(value: unknown): number | undefined {
    if (typeof value === 'number') {
      return value;
    }

    if (typeof value === 'string') {
      const match = value.match(/\d+/);
      return match ? Number(match[0]) : undefined;
    }

    return undefined;
  }

  private stringValue(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim() ? value : fallback;
  }

  applyFilters(): void {
    const cleanTerm = this.searchControl.value.trim().toLowerCase();

    let items = [...this.inspections];

    if (cleanTerm) {
      items = items.filter((item) =>
        item.id.toLowerCase().includes(cleanTerm) ||
        item.businessName.toLowerCase().includes(cleanTerm) ||
        item.address.toLowerCase().includes(cleanTerm) ||
        item.type.toLowerCase().includes(cleanTerm) ||
        item.status.toLowerCase().includes(cleanTerm)
      );
    }

    if (this.selectedStatus !== 'All') {
      items = items.filter((item) => this.getEffectiveStatus(item) === this.selectedStatus);
    }

    if (this.selectedPayment !== 'All') {
      items = items.filter((item) => item.paymentStatus === this.selectedPayment);
    }

    if (this.selectedInspector !== 'All') {
      items = items.filter((item) => item.inspector === this.selectedInspector);
    }

    switch (this.selectedSort) {
      case 'date-desc':
        items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        break;
      case 'date-asc':
        items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        break;
      case 'name-asc':
        items.sort((a, b) => a.businessName.localeCompare(b.businessName));
        break;
    }

    this.filteredInspections = items;
  }

  setStatusFilter(status: 'All' | 'Completed' | 'Pending' | 'Flagged'): void {
    this.selectedStatus = status;
    this.applyFilters();
  }

  setPaymentFilter(status: 'All' | 'Paid' | 'Unpaid'): void {
    this.selectedPayment = status;
    this.applyFilters();
  }

  setSort(value: 'date-desc' | 'date-asc' | 'name-asc'): void {
    this.selectedSort = value;
    this.applyFilters();
  }

  getInspectorOptions(): string[] {
    return [...new Set(this.inspections.map((item) => item.inspector))];
  }

  toggleInspectorFilter(): void {
    this.inspectorFilterOpen = !this.inspectorFilterOpen;
  }

  selectInspector(name: string | 'All'): void {
    this.selectedInspector = name;
    this.inspectorFilterOpen = false;
    this.applyFilters();
  }

  getEffectiveStatus(record: InspectionRecord): 'Completed' | 'Pending' | 'Flagged' {
    if (record.status === 'Flagged') {
      return 'Flagged';
    }

    if (record.paymentStatus === 'Paid') {
      return 'Completed';
    }

    return 'Pending';
  }

  get chartData(): Array<{ label: string; value: number }> {
    return this.chartMode === 'daily' ? this.getDailyInspectionSeries() : this.getMonthlyInspectionSeries();
  }

  get chartMaxValue(): number {
    const values = this.chartData.map((point) => point.value);
    return Math.max(1, ...values);
  }

  get peakChartValue(): number {
    return this.chartData.reduce((peak, point) => Math.max(peak, point.value), 0);
  }

  get chartPoints(): Array<{ x: number; y: number; label: string; value: number }> {
    if (!this.chartData.length) {
      return [];
    }

    const width = 620;
    const height = 200;
    const padding = 30;

    return this.chartData.map((point, index) => {
      const x = padding + (this.chartData.length === 1 ? 0 : index / (this.chartData.length - 1)) * (width - padding * 2);
      const y = height - padding - (point.value / this.chartMaxValue) * (height - padding * 2);
      return { ...point, x, y };
    });
  }

  get chartLinePath(): string {
    return this.chartPoints
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
      .join(' ');
  }

  private getDailyInspectionSeries(): Array<{ label: string; value: number }> {
    const counts = new Map<string, number>();

    for (const record of this.inspections) {
      const recordDate = this.parseRecordDate(record.date);
      if (!recordDate) {
        continue;
      }

      const dayKey = recordDate.toISOString().slice(0, 10);
      counts.set(dayKey, (counts.get(dayKey) ?? 0) + 1);
    }

    const recentDates = [...counts.keys()].sort().slice(-7);
    if (!recentDates.length) {
      return Array.from({ length: 7 }, (_, index) => {
        const date = new Date();
        date.setDate(date.getDate() - (6 - index));
        return { label: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), value: 0 };
      });
    }

    return recentDates.map((day) => ({
      label: new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      value: counts.get(day) ?? 0
    }));
  }

  private getMonthlyInspectionSeries(): Array<{ label: string; value: number }> {
    const counts = new Map<string, number>();

    for (const record of this.inspections) {
      const recordDate = this.parseRecordDate(record.date);
      if (!recordDate) {
        continue;
      }

      const monthKey = `${recordDate.getFullYear()}-${String(recordDate.getMonth() + 1).padStart(2, '0')}`;
      counts.set(monthKey, (counts.get(monthKey) ?? 0) + 1);
    }

    const now = new Date();
    const months: Array<{ label: string; value: number }> = [];

    for (let index = 5; index >= 0; index--) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - index, 1);
      const monthKey = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
      months.push({
        label: monthDate.toLocaleDateString(undefined, { month: 'short' }),
        value: counts.get(monthKey) ?? 0
      });
    }

    return months;
  }

  private updateInspectionPaymentState(record: InspectionRecord, nextPaymentStatus: 'Paid' | 'Unpaid'): InspectionRecord {
    const updatedRecord: InspectionRecord = {
      ...record,
      paymentStatus: nextPaymentStatus,
      status: nextPaymentStatus === 'Paid' ? 'Completed' : 'Pending',
      receiptNumber: record.receiptNumber?.trim() || ''
    };

    this.inspections = this.inspections.map((item) => item.id === record.id ? updatedRecord : item);
    this.filteredInspections = this.filteredInspections.map((item) => item.id === record.id ? updatedRecord : item);
    this.selectedInspection = { ...updatedRecord };

    return updatedRecord;
  }

  async markAsPaid(record: InspectionRecord): Promise<void> {
    const receiptNumber = record.receiptNumber?.trim() || '';
    const cashierNumber = record.cashierNumber?.trim() || '';

    try {
      const databaseInspectionId = record.databaseInspectionId ?? this.parseDatabaseId(record.id) ?? 0;
      await this.inspectionData.markInspectionAsPaid(String(databaseInspectionId), receiptNumber, cashierNumber, record.amount ?? 0);
      const updatedRecord = this.updateInspectionPaymentState(record, 'Paid');
      updatedRecord.receiptNumber = receiptNumber;
      localStorage.setItem(this.inspectionCacheKey, JSON.stringify(this.inspections));
      this.applyFilters();
    } catch (error) {
      console.error('Failed to save payment status:', error);
    }
  }

  togglePaymentStatus(record: InspectionRecord): void {
    const wasSelected = this.selectedInspection && this.selectedInspection.id === record.id;
    const nextPaymentStatus: 'Paid' | 'Unpaid' = record.paymentStatus === 'Paid' ? 'Unpaid' : 'Paid';
    const updatedRecord = this.updateInspectionPaymentState(record, nextPaymentStatus);

    if (updatedRecord.paymentStatus === 'Paid') {
      updatedRecord.receiptNumber = updatedRecord.receiptNumber?.trim() || '';
      updatedRecord.cashierNumber = updatedRecord.cashierNumber?.trim() || '';
      const databaseInspectionId = record.databaseInspectionId ?? this.parseDatabaseId(record.id) ?? 0;
      this.inspectionData.markInspectionAsPaid(String(databaseInspectionId), updatedRecord.receiptNumber, updatedRecord.cashierNumber, record.amount ?? 0).catch((error) => {
        console.error('Failed to save payment status:', error);
      });
    }

    if (wasSelected || this.selectedInspection?.id === record.id) {
      this.selectedInspection = { ...updatedRecord };
    }

    localStorage.setItem(this.inspectionCacheKey, JSON.stringify(this.inspections));
    this.applyFilters();
  }

  openInspection(record: InspectionRecord): void {
    this.selectedInspection = { ...record };
  }

  closeInspection(): void {
    this.selectedInspection = null;
  }

  toggleReportOptions(): void {
    this.reportOptionsOpen = !this.reportOptionsOpen;
  }

  generateDashboardReport(period: 'daily' | 'monthly'): void {
    const periodRecords = this.getRecordsByPeriod(this.filteredInspections, period);
    const records = period === 'daily' && !periodRecords.length
      ? this.getLatestAvailableDay(this.filteredInspections)
      : periodRecords;

    if (!records.length) {
      alert(`No ${period} records to include in the report.`);
      return;
    }

    this.reportOptionsOpen = false;

    const reportHtml = this.buildDashboardReport(records, period);
    const printWindow = window.open('', '_blank', 'width=1200,height=900');

    if (!printWindow) {
      alert('Popup blocked. Please allow popups to generate the printable report.');
      return;
    }

    printWindow.document.open();
    printWindow.document.write(reportHtml);
    printWindow.document.close();
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 250);
  }

  private getRecordsByPeriod(records: InspectionRecord[], period: 'daily' | 'monthly'): InspectionRecord[] {
    const now = new Date();

    return records.filter((record) => {
      const recordDate = this.parseRecordDate(record.date);
      if (!recordDate) {
        return false;
      }

      if (period === 'daily') {
        const createdAt = record.createdAt ? new Date(record.createdAt) : recordDate;
        return !Number.isNaN(createdAt.getTime()) && now.getTime() - createdAt.getTime() <= 24 * 60 * 60 * 1000;
      }

      return recordDate.getFullYear() === now.getFullYear() && recordDate.getMonth() === now.getMonth();
    });
  }

  private getLatestAvailableDay(records: InspectionRecord[]): InspectionRecord[] {
    const datedRecords = records
      .map((record) => ({ record, date: this.parseRecordDate(record.date) }))
      .filter((item): item is { record: InspectionRecord; date: Date } => item.date !== null)
      .sort((a, b) => b.date.getTime() - a.date.getTime());

    if (!datedRecords.length) {
      return [];
    }

    const latestDate = datedRecords[0].date;
    return datedRecords
      .filter((item) => item.date.toDateString() === latestDate.toDateString())
      .map((item) => item.record);
  }

  private parseRecordDate(value: string): Date | null {
    const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (dateOnlyMatch) {
      const year = Number(dateOnlyMatch[1]);
      const month = Number(dateOnlyMatch[2]) - 1;
      const day = Number(dateOnlyMatch[3]);
      return new Date(year, month, day);
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private buildDashboardReport(records: InspectionRecord[], period: 'daily' | 'monthly'): string {
    const generatedAt = new Date().toLocaleString();
    const reportTypeLabel = period === 'daily' ? 'Daily' : 'Monthly';
    const completed = records.filter((record) => this.getEffectiveStatus(record) === 'Completed').length;
    const pending = records.filter((record) => this.getEffectiveStatus(record) === 'Pending').length;
    const flagged = records.filter((record) => this.getEffectiveStatus(record) === 'Flagged').length;
    const collected = records
      .filter((record) => record.paymentStatus === 'Paid')
      .reduce((total, record) => total + (record.amount ?? 0), 0);

    const sortLabel =
      this.selectedSort === 'date-desc'
        ? 'Sort: date (desc)'
        : this.selectedSort === 'date-asc'
          ? 'Sort: date (asc)'
          : 'Sort: source (A-Z)';

    const rows = records
      .map((record) => {
        const status = this.getEffectiveStatus(record);
        const amount = record.amount !== null ? this.formatCurrency(record.amount) : 'N/A';

        return `<tr>
          <td>${this.escapeHtml(record.id)}</td>
          <td>${this.escapeHtml(record.businessName)}</td>
          <td>${this.escapeHtml(record.address)}</td>
          <td>${this.escapeHtml(record.type)}</td>
          <td class="status ${status.toLowerCase()}">${this.escapeHtml(status)}</td>
          <td class="payment ${record.paymentStatus.toLowerCase()}">${this.escapeHtml(record.paymentStatus)}</td>
          <td>${this.escapeHtml(record.inspector)}</td>
          <td>${this.escapeHtml(record.date)}</td>
          <td class="amount">${this.escapeHtml(amount)}</td>
        </tr>`;
      })
      .join('');

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Business Inspection Report</title>
  <style>
    @page { size: landscape; margin: 14mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #1d3047;
      background: #fff;
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
      font-size: 12px;
    }
    .sheet {
      width: 100%;
      max-width: 1120px;
      margin: 0 auto;
      border: 1px solid #d6e0ea;
      padding: 16px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      border-bottom: 2px solid #284e7a;
      padding-bottom: 8px;
      margin-bottom: 10px;
    }
    .brand {
      font-size: 27px;
      line-height: 1;
      color: #355b87;
      font-weight: 800;
      margin-right: 8px;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
      color: #1e426a;
    }
    .header p {
      margin: 2px 0 0;
      color: #4e6989;
      font-size: 11px;
    }
    .report-title {
      text-align: right;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 10px;
    }
    .stat {
      border: 1px solid #d9e4f0;
      border-radius: 8px;
      padding: 8px 10px;
      background: #fff;
    }
    .stat .value {
      font-size: 26px;
      font-weight: 800;
      color: #24466d;
      line-height: 1;
    }
    .stat .label {
      margin-top: 2px;
      font-size: 10px;
      color: #6a7f95;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .stat.completed .value { color: #1e8c5a; }
    .stat.pending .value { color: #b36a13; }
    .stat.flagged .value { color: #cc3a36; }
    .filter-line {
      border: 1px solid #d9e4f0;
      border-radius: 6px;
      background: #f8fbff;
      padding: 7px 10px;
      margin-bottom: 8px;
      color: #56708d;
      font-size: 11px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    th {
      font-size: 9.5px;
      color: #697d92;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid #d6e0ea;
      padding: 6px 5px;
      text-align: left;
    }
    td {
      font-size: 10.5px;
      border-bottom: 1px solid #e4ecf4;
      padding: 6px 5px;
      color: #1d2f42;
      vertical-align: top;
      word-wrap: break-word;
    }
    .status.completed, .payment.paid { color: #1b8757; font-weight: 700; }
    .status.pending, .payment.unpaid { color: #b36a13; font-weight: 700; }
    .status.flagged { color: #cc3a36; font-weight: 700; }
    .amount { text-align: right; font-weight: 700; }
    .signatures {
      margin-top: 24px;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 28px;
      align-items: end;
    }
    .sign-line {
      border-top: 1px solid #4f647d;
      text-align: center;
      padding-top: 4px;
      font-size: 9.5px;
      color: #435a74;
      font-weight: 700;
    }
    .footer {
      margin-top: 8px;
      font-size: 9px;
      color: #6f8398;
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div>
        <div style="display:flex;align-items:flex-end;gap:8px">
          <span class="brand">TI</span>
          <div>
            <h1>Tax Inspection</h1>
            <p>ADMIN PORTAL · OFFICIAL REPORT</p>
          </div>
        </div>
      </div>
      <div class="report-title">
        <h1 style="font-size:20px;margin:0">Business Inspection Report</h1>
        <p>Generated: ${this.escapeHtml(generatedAt)}</p>
      </div>
    </div>

    <div class="stats">
      <div class="stat"><div class="value">${records.length}</div><div class="label">Total Records</div></div>
      <div class="stat completed"><div class="value">${completed}</div><div class="label">Completed</div></div>
      <div class="stat pending"><div class="value">${pending}</div><div class="label">Pending</div></div>
      <div class="stat flagged"><div class="value">${flagged}</div><div class="label">Flagged</div></div>
      <div class="stat"><div class="value">${this.escapeHtml(this.formatCurrency(collected))}</div><div class="label">Collected</div></div>
    </div>

    <div class="filter-line">Report type: ${this.escapeHtml(reportTypeLabel)} · Filter: ${this.escapeHtml(this.selectedStatus)} records · ${this.escapeHtml(sortLabel)}</div>

    <table>
      <thead>
        <tr>
          <th style="width:9%">ID</th>
          <th style="width:18%">Source of Material</th>
          <th style="width:17%">Address</th>
          <th style="width:11%">Type</th>
          <th style="width:9%">Status</th>
          <th style="width:9%">Payment</th>
          <th style="width:11%">Inspector</th>
          <th style="width:8%">Date</th>
          <th style="width:8%;text-align:right">Amount</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="signatures">
      <div class="sign-line">PREPARED BY<br/><span style="font-weight:400">Signature over Printed Name</span></div>
      <div class="sign-line">VERIFIED BY<br/><span style="font-weight:400">Signature over Printed Name</span></div>
      <div class="sign-line">APPROVED BY<br/><span style="font-weight:400">Signature over Printed Name</span></div>
    </div>

    <div class="footer">Tax Inspection Admin Portal · Confidential · ${this.escapeHtml(new Date().toLocaleDateString())}</div>
  </div>
</body>
</html>`;
  }

  private formatCurrency(value: number): string {
    return `₱${value.toLocaleString()}`;
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  showView(view: 'home' | 'new-inspection' | 'inspections' | 'analytics' | 'users' | 'settings'): void {
    this.activeView = view;
    this.showProfile = false;
    this.settingsNotice = '';
  }

  showSettingsNotice(message: string): void {
    this.settingsNotice = message;
  }

  setUserStatus(status: string): void { this.selectedUserStatus = status; }

  async toggleUserStatus(user: { email: string; status: string }): Promise<void> {
    const nextStatus = user.status === 'Active' ? 'inactive' : 'active';
    const previousStatus = user.status;
    user.status = nextStatus === 'active' ? 'Active' : 'Inactive';

    try {
      await this.inspectionData.setUserStatus(user.email, nextStatus);
      await this.loadUsers();
    } catch (error) {
      user.status = previousStatus;
      console.error('Failed to save user status:', error);
      alert('The user status could not be saved.');
    }
  }

  onSignOut(): void {
    console.log('Terminating secure token session... Redirecting down to auth portal identity route.');
    localStorage.removeItem('loggedInRole');
    this.router.navigate(['/']);
  }
}