import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { InspectionDataService } from '../services/inspection-data.service';

@Component({
  selector: 'app-inspection',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './inspection.component.html',
  styleUrls: ['./inspection.component.scss']
})
export class InspectionComponent implements OnInit {
  inspectionForm!: FormGroup;
  todayInspectionCount = 0;
  isSubmitting = false;
  lastSubmittedAt = '';
  showSettings = false;
  settingsNotice = '';
  brandMenuOpen = false;
  activeNav: 'home' | 'inspections' | 'pending' = 'home';
  inspectorName = 'Field Officer';
  loggedInInspectorEmail = '';
  profilePicture = '';
  pendingInspections: Array<{ id: string; payload: Record<string, unknown>; storedAt: string }> = [];
  isSyncingPending = false;
  isOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
  pendingSyncNotice = '';
  chartMode: 'daily' | 'monthly' = 'daily';
  inspectionTrend: Array<{ label: string; value: number }> = [];

  truckTypes = ['6 Wheelers', '8 Wheelers', '10 Wheelers'];
  materialKinds = ['Sand', 'Gravel', 'Filling Materials'];
  quantityOptions = Array.from({ length: 11 }, (_, i) => `${10 + i} cubic meters`);
  penaltyRate = 75;

  constructor(private fb: FormBuilder, private router: Router, private inspectionData: InspectionDataService) {}

  ngOnInit(): void {
    const storedName = localStorage.getItem('loggedInInspectorName');
    if (storedName) {
      this.inspectorName = storedName;
    }

    const storedEmail = localStorage.getItem('loggedInInspectorEmail');
    if (storedEmail) {
      this.loggedInInspectorEmail = storedEmail;
    }
    this.profilePicture = localStorage.getItem(this.profilePictureStorageKey()) ?? '';

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
      deliveryReceipt: ['', Validators.required],
      deliveryReceiptFile: [null]
    });

    this.loadPendingInspections();
    this.loadInspectionTrend();
    window.addEventListener('online', this.handleConnectionChange);
    window.addEventListener('offline', this.handleConnectionChange);
    this.inspectionData.getPenaltyRate().then((rate) => {
      this.penaltyRate = rate;
    }).catch((error) => {
      console.error('Could not load penalty rate:', error);
    });
  }

  get chartData(): Array<{ label: string; value: number }> {
    return this.chartMode === 'daily' ? this.getDailyInspectionTrend() : this.getMonthlyInspectionTrend();
  }

  get chartMaxValue(): number {
    return Math.max(1, ...this.chartData.map((point) => point.value));
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

  private getDailyInspectionTrend(): Array<{ label: string; value: number }> {
    const counts = new Map<string, number>();

    for (const item of this.inspectionTrend) {
      if (!item.label || !item.value) {
        continue;
      }
    }

    const records = [...this.inspectionTrend];
    if (!records.length) {
      return Array.from({ length: 7 }, (_, index) => {
        const date = new Date();
        date.setDate(date.getDate() - (6 - index));
        return { label: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), value: 0 };
      });
    }

    const countsByDay = new Map<string, number>();
    for (const record of records) {
      const key = record.label;
      countsByDay.set(key, (countsByDay.get(key) ?? 0) + record.value);
    }

    const orderedDays = [...countsByDay.keys()].sort();
    const recentDays = orderedDays.slice(-7);
    return recentDays.map((day) => ({ label: day, value: countsByDay.get(day) ?? 0 }));
  }

  private getMonthlyInspectionTrend(): Array<{ label: string; value: number }> {
    const now = new Date();
    const buckets = new Map<string, number>();

    for (const record of this.inspectionTrend) {
      const label = record.label;
      const normalized = label.includes('/') ? label : label;
      const monthKey = normalized;
      buckets.set(monthKey, (buckets.get(monthKey) ?? 0) + record.value);
    }

    const months: Array<{ label: string; value: number }> = [];
    for (let index = 5; index >= 0; index--) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - index, 1);
      const monthLabel = monthDate.toLocaleDateString(undefined, { month: 'short' });
      months.push({ label: monthLabel, value: buckets.get(monthLabel) ?? 0 });
    }

    return months;
  }

  private async loadInspectionTrend(): Promise<void> {
    try {
      const records = await this.inspectionData.listInspections();
      const entries = records
        .filter((record) => typeof record['date'] === 'string' || typeof record['inspection_date'] === 'string' || typeof record['created_at'] === 'string')
        .map((record) => {
          const rawDate = String(record['date'] ?? record['inspection_date'] ?? record['created_at'] ?? '');
          const parsed = rawDate ? new Date(rawDate) : null;
          if (!parsed || Number.isNaN(parsed.getTime())) {
            return null;
          }

          const dateKey = parsed.toISOString().slice(0, 10);
          return {
            label: parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
            value: 1,
            monthLabel: parsed.toLocaleDateString(undefined, { month: 'short' }),
            dateKey
          };
        })
        .filter((entry): entry is { label: string; value: number; monthLabel: string; dateKey: string } => !!entry);

      const byDay = new Map<string, number>();
      const byMonth = new Map<string, number>();
      for (const entry of entries) {
        byDay.set(entry.dateKey, (byDay.get(entry.dateKey) ?? 0) + entry.value);
        byMonth.set(entry.monthLabel, (byMonth.get(entry.monthLabel) ?? 0) + entry.value);
      }

      const dailyLabels = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-7);
      this.inspectionTrend = dailyLabels.map(([dateKey, value]) => ({
        label: new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        value
      }));

      if (!this.inspectionTrend.length) {
        this.inspectionTrend = Array.from({ length: 7 }, (_, index) => {
          const date = new Date();
          date.setDate(date.getDate() - (6 - index));
          return { label: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), value: 0 };
        });
      }

      const monthLabels = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b));
      if (monthLabels.length) {
        const monthEntries = monthLabels.map(([label, value]) => ({ label, value }));
        const now = new Date();
        const monthlyData: Array<{ label: string; value: number }> = [];
        for (let index = 5; index >= 0; index--) {
          const monthDate = new Date(now.getFullYear(), now.getMonth() - index, 1);
          const monthLabel = monthDate.toLocaleDateString(undefined, { month: 'short' });
          const found = monthEntries.find((item) => item.label === monthLabel);
          monthlyData.push({ label: monthLabel, value: found ? found.value : 0 });
        }
        this.inspectionTrend = monthlyData;
      }
    } catch (error) {
      console.error('Failed to load field officer inspection trend:', error);
    }
  }

  // Convenience getter for easy access to form fields
  get f() {
    return this.inspectionForm.controls;
  }

  get selectedQuantity(): number {
    const value = this.inspectionForm?.get('quantity')?.value ?? '0';
    return Number.parseInt(String(value), 10) || 0;
  }

  get allowedVolume(): number {
    return this.inspectionForm?.get('truckType')?.value === '10 Wheelers' ? 15 : 10;
  }

  get excessVolume(): number {
    return Math.max(this.selectedQuantity - this.allowedVolume, 0);
  }

  get penaltyAmount(): number {
    return this.excessVolume * this.penaltyRate;
  }

  // Called when the form is submitted
  onSubmit(): void {
    if (this.inspectionForm.invalid) {
      this.inspectionForm.markAllAsTouched();
      return;
    }

    const formValue = this.inspectionForm.value;
    const payload = {
      hauler_name: formValue.haulerName,
      truck_plate: formValue.truckPlate,
      time: formValue.time,
      truck_type: formValue.truckType,
      address: formValue.address,
      source_of_material: formValue.sourceOfMaterial,
      kind_of_material: formValue.kindOfMaterial,
      quantity: formValue.quantity,
      place_of_delivery: formValue.placeOfDelivery,
      delivery_receipt: formValue.deliveryReceipt,
      delivery_receipt_file: formValue.deliveryReceiptFile?.name ?? null,
      quantity_cubic_meters: this.selectedQuantity,
      allowed_volume: this.allowedVolume,
      excess_volume: this.excessVolume,
      penalty_rate: this.penaltyRate,
      penalty_amount: this.penaltyAmount,
      inspector: this.inspectorName
    };
    this.isSubmitting = true;

    this.inspectionData.createInspection(payload).then(() => {
        this.todayInspectionCount += 1;
        this.lastSubmittedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        this.isSubmitting = false;
        alert('The data was submitted');
        this.afterSubmitSuccess();
      }).catch((error: unknown) => {
        console.error('Failed to submit inspection:', error);
        this.isSubmitting = false;
        const message = this.errorMessage(error);

        if (message.toLowerCase().includes('offline') || message.toLowerCase().includes('no internet')) {
          this.todayInspectionCount += 1;
          this.lastSubmittedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          this.loadPendingInspections();
          alert('No internet connection. The inspection was saved offline and will sync automatically when you are back online.');
          this.afterSubmitSuccess();
          return;
        }

        const setupFile = message.includes('submit_inspection')
          ? 'Run supabase/fix_submission_rpc.sql in Supabase SQL Editor.'
          : 'Verify that supabase/inspections.sql has been run.';
        alert(`The inspection could not be submitted. ${setupFile}\n\n${message}`);
      });
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'object' && error !== null && 'message' in error) {
      return String(error.message);
    }

    return 'Supabase rejected the request.';
  }

  logout(): void {
    const email = localStorage.getItem('loggedInInspectorEmail');
    if (email) {
      localStorage.removeItem('loggedInInspectorEmail');
    }
    localStorage.removeItem('loggedInRole');
    this.router.navigate(['/']);
  }

  openSettings(): void {
    this.showSettings = true;
    this.settingsNotice = '';
    this.brandMenuOpen = false;
  }

  toggleBrandMenu(): void {
    this.brandMenuOpen = !this.brandMenuOpen;
  }

  closeSettings(): void {
    this.showSettings = false;
  }

  selectNavigation(view: 'home' | 'inspections' | 'pending'): void {
    this.activeNav = view;
    this.showSettings = false;

    if (view === 'inspections') {
      setTimeout(() => document.getElementById('new-inspection')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  loadPendingInspections(): void {
    this.pendingInspections = this.inspectionData.getPendingInspections();
  }

  async syncPendingInspections(): Promise<void> {
    if (!this.isOnline || this.isSyncingPending) {
      if (!this.isOnline) {
        this.pendingSyncNotice = 'Connect to the internet before submitting pending data.';
      }
      return;
    }

    this.isSyncingPending = true;
    this.pendingSyncNotice = '';
    try {
      const syncedCount = await this.inspectionData.syncPendingInspections();
      this.loadPendingInspections();
      this.pendingSyncNotice = syncedCount
        ? `${syncedCount} pending inspection${syncedCount === 1 ? '' : 's'} submitted successfully.`
        : 'No pending inspections were submitted.';
    } catch (error) {
      console.error('Could not submit pending inspections:', error);
      this.loadPendingInspections();
      this.pendingSyncNotice = 'Some pending inspections could not be submitted. Please try again.';
    } finally {
      this.isSyncingPending = false;
    }
  }

  private handleConnectionChange = (): void => {
    this.isOnline = navigator.onLine;
    this.loadPendingInspections();
  };

  ngOnDestroy(): void {
    window.removeEventListener('online', this.handleConnectionChange);
    window.removeEventListener('offline', this.handleConnectionChange);
  }

  showSettingsNotice(message: string): void {
    this.settingsNotice = message;
  }

  onProfilePictureSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      alert('Please select an image file.');
      input.value = '';
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      alert('Please choose an image smaller than 2 MB.');
      input.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const image = String(reader.result ?? '');
      this.profilePicture = image;
      localStorage.setItem(this.profilePictureStorageKey(), image);
    };
    reader.readAsDataURL(file);
  }

  private profilePictureStorageKey(): string {
    const email = this.loggedInInspectorEmail.trim().toLowerCase() || 'field-officer';
    return `profile-picture:${email}`;
  }

  afterSubmitSuccess(): void {
    // Reset but keep some defaults
    const defaults = {
      truckType: '6 Wheelers',
      kindOfMaterial: 'Sand',
      quantity: '10 cubic meters'
    };
    this.inspectionForm.reset({ ...defaults });
  }

  // Reset form fully
  resetForm(): void {
    this.inspectionForm.reset({
      truckType: '6 Wheelers',
      kindOfMaterial: 'Sand',
      quantity: '10 cubic meters'
    });
  }

  // Helper to set truck type (e.g., when user selects radio)
  setTruckType(type: string): void {
    if (this.truckTypes.includes(type)) {
      this.inspectionForm.patchValue({ truckType: type });
    }
  }

  // Helper to set material kind
  setMaterialKind(kind: string): void {
    if (this.materialKinds.includes(kind)) {
      this.inspectionForm.patchValue({ kindOfMaterial: kind });
    }
  }

  // Handle file input change for delivery receipt
  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      this.inspectionForm.patchValue({ deliveryReceiptFile: null });
      return;
    }
    const file = input.files[0];
    this.inspectionForm.patchValue({ deliveryReceiptFile: file });
  }
}
